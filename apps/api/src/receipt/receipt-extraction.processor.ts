import { type ExtractionResult } from '@myfinpro/shared';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductMatchingService, type MatchProposal } from '../product/product-matching.service';
import { RECEIPT_EXTRACTIONS_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { mapReceiptToDto, type ReceiptWithRelations } from './dto/receipt-response.dto';
import {
  ExtractionFailedError,
  type ExtractionInput,
} from './extraction/extraction-provider.interface';
import {
  ExtractionResolverService,
  type ResolvedExtraction,
} from './extraction/extraction-resolver.service';
import { ReceiptStorageService } from './receipt-storage.service';
import { RECEIPT_INCLUDE } from './receipt.service';
import { ReceiptUrlIntakeService } from './url-intake/receipt-url-intake.service';

type ExtractionJobData = { receiptId: string };

type ProcessOutcome =
  | { extracted: true; receiptId: string; items: number }
  | { extracted: false; reason: string };

/**
 * Phase 7, iteration 7.6 — the extraction worker (design §6.2).
 *
 * Owns the status machine past UPLOADED:
 *   UPLOADED/EXTRACTING → EXTRACTING → REVIEW (items persisted), or
 *   → FAILED (permanent provider error, or transient errors exhausted).
 *
 * Duplicate fires are no-ops via the status guard (REVIEW/CONFIRMED/FAILED
 * are never re-entered here; the retry endpoint resets FAILED → UPLOADED).
 * Permanent `ExtractionFailedError`s fail the receipt WITHOUT re-throwing so
 * BullMQ does not burn retries on bad input; transient errors re-throw and
 * ride the job's attempts/backoff, failing the receipt on the last attempt.
 */
@Processor(RECEIPT_EXTRACTIONS_QUEUE)
export class ReceiptExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ReceiptExtractionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ReceiptStorageService,
    private readonly categoryService: CategoryService,
    private readonly productMatcher: ProductMatchingService,
    private readonly eventBus: EventBus,
    private readonly extractionResolver: ExtractionResolverService,
    private readonly urlIntake: ReceiptUrlIntakeService,
  ) {
    super();
  }

  async process(job: Job<ExtractionJobData>): Promise<ProcessOutcome> {
    const { receiptId } = job.data;

    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { uploadedBy: { select: { id: true, locale: true } } },
    });
    if (!receipt) {
      this.logger.warn(`[orphan] receipt ${receiptId} not found — skipping`);
      return { extracted: false, reason: 'receipt_missing' };
    }
    // Status guard — only UPLOADED (fresh/retried) and EXTRACTING (this
    // job's own earlier attempt) proceed.
    if (receipt.status !== 'UPLOADED' && receipt.status !== 'EXTRACTING') {
      this.logger.log(
        `[skipped] receipt ${receiptId} is ${receipt.status} — duplicate fire is a no-op`,
      );
      return { extracted: false, reason: `status_${receipt.status.toLowerCase()}` };
    }

    if (receipt.status !== 'EXTRACTING') {
      await this.prisma.receipt.update({
        where: { id: receiptId },
        data: { status: 'EXTRACTING' },
      });
      await this.publishUpdated(receipt.uploadedById, receiptId);
    }

    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    // Phase 8.11 — resolved inside the try so a permanent resolver failure
    // (selected model retired, no API key) rides the normal FAILED path.
    let resolved: ResolvedExtraction | null = null;
    try {
      resolved = await this.extractionResolver.resolveForUser(receipt.uploadedById);
      const input = await this.buildInput(receipt);

      // Candidate categories: the uploader's visible OUT set (BOTH matches).
      const categories = await this.categoryService.list(receipt.uploadedById, {
        direction: 'OUT',
      });
      const candidates = categories.map((c) => ({ id: c.id, name: c.name }));
      const candidateIds = new Set(candidates.map((c) => c.id));

      // Product candidates for LLM ranking — the cross-language matching
      // stage (Phase 8.3, design §1.2).
      const productCandidates = await this.productMatcher.getUserProductCandidates(
        receipt.uploadedById,
      );
      const productCandidateIds = new Set(productCandidates.map((p) => p.id));

      const result = await resolved.provider.extract(input, {
        categories: candidates,
        products: productCandidates,
        locale: receipt.uploadedBy?.locale ?? undefined,
      });

      // Phase 8.17 — never land a receipt in REVIEW with nothing in it. A
      // JS-rendered page we can't read, or an unrelated link, yields an
      // all-empty result; fail it with actionable guidance instead of a
      // silent empty review. (For URL receipts, also record the empty
      // outcome in the anonymized log so we can spot providers to adapt.)
      if (isEmptyExtraction(result)) {
        if (receipt.source === 'url' && receipt.sourceUrl) {
          void this.urlIntake.recordUrlOutcome(receipt.sourceUrl, null, 'empty_result');
        }
        throw new ExtractionFailedError(
          receipt.source === 'url'
            ? 'Could not read this receipt from the link (it may load its content in the browser). ' +
                'Open the link and upload a screenshot or PDF instead.'
            : 'Could not read any receipt details from this file.',
        );
      }

      // Providers must pick product ids from the injected list; drop drift,
      // then run the deterministic stages and merge (Phase 8.3).
      const proposals = await this.productMatcher.matchItems(
        result.items.map((item) => ({
          rawName: item.rawName,
          suggestedProductId:
            item.suggestedProductId && productCandidateIds.has(item.suggestedProductId)
              ? item.suggestedProductId
              : null,
        })),
        result.confidence,
      );

      const itemCount = await this.persistResult(receiptId, result, candidateIds, proposals);
      void this.writeAudit(receipt.uploadedById, receiptId, 'RECEIPT_EXTRACTED', {
        provider: resolved.providerName,
        model: resolved.model,
        keySource: resolved.keySource,
        items: itemCount,
        confidence: result.confidence,
      });
      await this.publishUpdated(receipt.uploadedById, receiptId);
      this.logger.log(
        `Receipt ${receiptId} extracted via '${resolved.providerName}' ` +
          `(model=${resolved.model ?? 'default'} keySource=${resolved.keySource}, ` +
          `${itemCount} items) → REVIEW`,
      );
      return { extracted: true, receiptId, items: itemCount };
    } catch (err) {
      const permanent = err instanceof ExtractionFailedError;
      if (permanent || isFinalAttempt) {
        const reason = (err as Error).message?.slice(0, 500) || 'Extraction failed';
        await this.prisma.receipt.update({
          where: { id: receiptId },
          data: { status: 'FAILED', failureReason: reason },
        });
        void this.writeAudit(receipt.uploadedById, receiptId, 'RECEIPT_EXTRACTION_FAILED', {
          provider: resolved?.providerName ?? 'unresolved',
          model: resolved?.model ?? null,
          keySource: resolved?.keySource ?? null,
          permanent,
          reason,
        });
        await this.publishUpdated(receipt.uploadedById, receiptId);
        this.logger.warn(
          `Receipt ${receiptId} FAILED (${permanent ? 'permanent' : 'final attempt'}): ${reason}`,
        );
        if (permanent) {
          // Swallow — retrying bad input just burns provider calls.
          return { extracted: false, reason: 'permanent_failure' };
        }
      }
      throw err; // transient → BullMQ retry (already marked FAILED on final attempt)
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async buildInput(receipt: {
    id: string;
    source: string;
    fileRef: string | null;
    mimeType: string | null;
    sourceUrl: string | null;
  }): Promise<ExtractionInput> {
    if (receipt.source === 'url') {
      if (!receipt.sourceUrl) {
        throw new ExtractionFailedError('URL receipt has no sourceUrl');
      }
      // Phase 8.17 — provider adapters (client-rendered SPAs → their JSON
      // data endpoint), generic PDF/image/HTML routing, egress politeness and
      // anonymized analysis logging all live in the intake service.
      return this.urlIntake.resolve(receipt.sourceUrl);
    }
    if (!receipt.fileRef) {
      throw new ExtractionFailedError('Receipt has no stored file');
    }
    const buffer = await this.storage.read(receipt.fileRef);
    if (receipt.mimeType === 'application/pdf') {
      return { kind: 'pdf', data: buffer };
    }
    return { kind: 'image', data: buffer, mimeType: receipt.mimeType ?? 'image/jpeg' };
  }

  /** Persist header + items and flip to REVIEW in one transaction. */
  private async persistResult(
    receiptId: string,
    result: ExtractionResult,
    candidateIds: Set<string>,
    proposals: MatchProposal[],
  ): Promise<number> {
    // Default categories for auto-linked products backfill lines the
    // extraction left uncategorized (only ids visible to the uploader).
    const autoIds = [
      ...new Set(proposals.map((p) => p.autoProductId).filter((id): id is string => !!id)),
    ];
    const autoDefaults = new Map(
      autoIds.length > 0
        ? (
            await this.prisma.product.findMany({
              where: { id: { in: autoIds } },
              select: { id: true, defaultCategoryId: true },
            })
          ).map((p) => [p.id, p.defaultCategoryId])
        : [],
    );

    const purchasedAt = result.purchasedAt ? new Date(result.purchasedAt) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receiptId },
        data: {
          status: 'REVIEW',
          extractedMerchantName: result.merchantName,
          purchasedAt,
          currency: result.currency,
          totalCents: result.totalCents,
          discountCents: result.discountCents,
          rawExtraction: result as unknown as Prisma.InputJsonValue,
          failureReason: null,
        },
      });
      await tx.receiptItem.deleteMany({ where: { receiptId } });
      if (result.items.length > 0) {
        await tx.receiptItem.createMany({
          data: result.items.map((item, index) => {
            const proposal = proposals[index];
            const autoProductId = proposal?.autoProductId ?? null;
            // Providers must pick from the candidate list; drop anything else.
            let categoryId =
              item.suggestedCategoryId && candidateIds.has(item.suggestedCategoryId)
                ? item.suggestedCategoryId
                : null;
            if (!categoryId && autoProductId) {
              const fallback = autoDefaults.get(autoProductId);
              if (fallback && candidateIds.has(fallback)) categoryId = fallback;
            }
            return {
              receiptId,
              position: index + 1,
              rawName: item.rawName.slice(0, 300),
              quantity: new Prisma.Decimal(item.quantity.toFixed(3)),
              unitPriceCents: item.unitPriceCents,
              discountCents: item.discountCents,
              totalCents: item.totalCents,
              categoryId,
              productId: autoProductId,
              matchStatus: autoProductId ? 'AUTO' : 'PENDING',
              matchCandidates:
                proposal && proposal.candidates.length > 0
                  ? (proposal.candidates as unknown as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
              purchasedAt,
            };
          }),
        });
      }
    });
    return result.items.length;
  }

  /** Best-effort realtime fan-out with the FRESH row (post-transition). */
  private async publishUpdated(userId: string, receiptId: string): Promise<void> {
    try {
      const row = await this.prisma.receipt.findUnique({
        where: { id: receiptId },
        include: RECEIPT_INCLUDE,
      });
      if (row) {
        this.eventBus.publish({
          type: 'receipt.updated',
          userIds: [userId],
          receipt: mapReceiptToDto(row as ReceiptWithRelations),
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to publish receipt.updated for ${receiptId}: ${(err as Error).message}`,
      );
    }
  }

  private async writeAudit(
    userId: string,
    receiptId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Receipt',
          entityId: receiptId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write ${action} audit log for receipt ${receiptId}: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * True when extraction yielded nothing usable — no merchant, no positive
 * total, and no line items. Such a result is worthless as a review (it can't
 * become a payment) and usually means the content was never actually read
 * (a JS-rendered page, an unrelated link). Phase 8.17.
 */
export function isEmptyExtraction(result: ExtractionResult): boolean {
  const noMerchant = !result.merchantName || result.merchantName.trim().length === 0;
  const noTotal = result.totalCents === null || result.totalCents <= 0;
  const noItems = result.items.length === 0;
  return noMerchant && noTotal && noItems;
}
