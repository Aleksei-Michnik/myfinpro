import type { ExtractionResult } from '@myfinpro/shared';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPT_EXTRACTIONS_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { mapReceiptToDto, type ReceiptWithRelations } from './dto/receipt-response.dto';
import {
  ExtractionFailedError,
  RECEIPT_EXTRACTION_PROVIDER,
  type ExtractionInput,
  type ReceiptExtractionProvider,
} from './extraction/extraction-provider.interface';
import { ReceiptStorageService } from './receipt-storage.service';
import { RECEIPT_INCLUDE } from './receipt.service';
import { assertPublicReceiptUrl, UnsafeReceiptUrlError } from './utils/receipt-url-guard.util';

type ExtractionJobData = { receiptId: string };

type ProcessOutcome =
  | { extracted: true; receiptId: string; items: number }
  | { extracted: false; reason: string };

/** Cap for fetched URL snapshots handed to the provider. */
const URL_SNAPSHOT_MAX_CHARS = 500_000;
const URL_FETCH_TIMEOUT_MS = 20_000;
/** Redirect hops the fetcher will follow (each re-validated by the SSRF guard). */
const URL_MAX_REDIRECTS = 5;

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
    private readonly eventBus: EventBus,
    @Inject(RECEIPT_EXTRACTION_PROVIDER) private readonly provider: ReceiptExtractionProvider,
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
    try {
      const input = await this.buildInput(receipt);

      // Candidate categories: the uploader's visible OUT set (BOTH matches).
      const categories = await this.categoryService.list(receipt.uploadedById, {
        direction: 'OUT',
      });
      const candidates = categories.map((c) => ({ id: c.id, name: c.name }));
      const candidateIds = new Set(candidates.map((c) => c.id));

      const result = await this.provider.extract(input, {
        categories: candidates,
        locale: receipt.uploadedBy?.locale ?? undefined,
      });

      const itemCount = await this.persistResult(receiptId, result, candidateIds);
      void this.writeAudit(receipt.uploadedById, receiptId, 'RECEIPT_EXTRACTED', {
        provider: this.provider.name,
        items: itemCount,
        confidence: result.confidence,
      });
      await this.publishUpdated(receipt.uploadedById, receiptId);
      this.logger.log(
        `Receipt ${receiptId} extracted via '${this.provider.name}' (${itemCount} items) → REVIEW`,
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
          provider: this.provider.name,
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
      const snapshot = await this.fetchUrlSnapshot(receipt.sourceUrl);
      return { kind: 'html', data: snapshot, sourceUrl: receipt.sourceUrl };
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

  /**
   * Fetch the online receipt. Redirects are followed manually so the SSRF
   * guard runs on every hop (a `redirect: 'follow'` would let a public URL
   * bounce to an internal address unchecked). Transient network / 5xx errors
   * ride the BullMQ retry path; unsafe targets and 4xx are permanent.
   */
  private async fetchUrlSnapshot(url: string): Promise<string> {
    let current: URL;
    try {
      current = assertPublicReceiptUrl(url);
    } catch (err) {
      throw new ExtractionFailedError(
        err instanceof UnsafeReceiptUrlError ? err.message : 'Invalid receipt URL',
      );
    }

    for (let hop = 0; hop <= URL_MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: { 'User-Agent': 'myfinpro-receipt-fetcher/1.0' },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new ExtractionFailedError('Redirect without a Location header');
        if (hop === URL_MAX_REDIRECTS) throw new ExtractionFailedError('Too many redirects');
        try {
          current = assertPublicReceiptUrl(new URL(location, current).toString());
        } catch (err) {
          throw new ExtractionFailedError(
            err instanceof UnsafeReceiptUrlError ? err.message : 'Invalid redirect target',
          );
        }
        continue;
      }

      if (!res.ok) {
        // Permanent for client errors (dead link), transient for 5xx.
        if (res.status >= 400 && res.status < 500) {
          throw new ExtractionFailedError(`Receipt URL returned ${res.status}`);
        }
        throw new Error(`Receipt URL fetch failed (${res.status})`);
      }
      const text = await res.text();
      return text.slice(0, URL_SNAPSHOT_MAX_CHARS);
    }
    // Unreachable — the loop returns or throws — but satisfies the type checker.
    throw new ExtractionFailedError('Too many redirects');
  }

  /** Persist header + items and flip to REVIEW in one transaction. */
  private async persistResult(
    receiptId: string,
    result: ExtractionResult,
    candidateIds: Set<string>,
  ): Promise<number> {
    await this.prisma.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receiptId },
        data: {
          status: 'REVIEW',
          extractedMerchantName: result.merchantName,
          purchasedAt: result.purchasedAt ? new Date(result.purchasedAt) : null,
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
          data: result.items.map((item, index) => ({
            receiptId,
            position: index + 1,
            rawName: item.rawName.slice(0, 300),
            quantity: new Prisma.Decimal(item.quantity.toFixed(3)),
            unitPriceCents: item.unitPriceCents,
            discountCents: item.discountCents,
            totalCents: item.totalCents,
            // Providers must pick from the candidate list; drop anything else.
            categoryId:
              item.suggestedCategoryId && candidateIds.has(item.suggestedCategoryId)
                ? item.suggestedCategoryId
                : null,
          })),
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
