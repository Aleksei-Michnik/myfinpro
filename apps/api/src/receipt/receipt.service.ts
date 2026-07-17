import {
  decodeCursor,
  dominantReceiptCategoryId,
  encodeCursor,
  normalizeLookupName,
  PAGINATION_DEFAULTS,
  RECEIPT_MAX_FILES,
} from '@myfinpro/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_ERRORS } from '../product/constants/product-errors';
import { ProductService } from '../product/product.service';
import { RECEIPT_EXTRACTIONS_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { UpdateTransactionDto } from '../transaction/dto/update-transaction.dto';
import { TransactionService } from '../transaction/transaction.service';
import { RECEIPT_ERRORS } from './constants/receipt-errors';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { CreateManualReceiptDto } from './dto/create-manual-receipt.dto';
import { CreateReceiptUrlDto } from './dto/create-receipt-url.dto';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto';
import { MatchItemDto } from './dto/match-item.dto';
import {
  mapReceiptToDto,
  ReceiptResponseDto,
  type ReceiptWithRelations,
} from './dto/receipt-response.dto';
import { ReconcileReceiptDto } from './dto/reconcile-receipt.dto';
import { ReplaceItemsDto } from './dto/replace-items.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { ReceiptStorageService } from './receipt-storage.service';
import { assertPublicReceiptUrl, UnsafeReceiptUrlError } from './utils/receipt-url-guard.util';

/** Include set every read path uses — items (+ product join), merchant, pages. */
export const RECEIPT_INCLUDE = {
  items: { include: { product: { select: { name: true, brand: true } } } },
  merchant: { select: { name: true } },
  files: { orderBy: { position: 'asc' } },
} satisfies Prisma.ReceiptInclude;

/** List envelope (Phase 6 pagination conventions). */
export interface ReceiptListResponse {
  data: ReceiptResponseDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Phase 7, iteration 7.4 — receipt CRUD + extraction-job producer.
 *
 * Receipts are strictly private to their uploader in this phase (design
 * §4): every accessor filters on `uploadedById`, and missing/foreign ids
 * both read as 404 (no existence leak — the Phase 6 convention).
 *
 * Extraction runs async: creation enqueues a BullMQ job (attempts 3,
 * exponential backoff); the 7.6 worker owns the status machine past
 * UPLOADED. Realtime `receipt.updated` events fan out to the uploader on
 * every mutation here so open tabs track the lifecycle live.
 */
@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ReceiptStorageService,
    private readonly eventBus: EventBus,
    private readonly categoryService: CategoryService,
    private readonly transactionService: TransactionService,
    private readonly productService: ProductService,
    @InjectQueue(RECEIPT_EXTRACTIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * POST /receipts — multipart upload. Several image files are the pages of
   * ONE long receipt, in the given order (8.22); a PDF is always a single
   * file. When `transactionId` is set (Phase 8.15, `POST
   * /transactions/:id/receipt`) the receipt is born linked to that transaction
   * and confirmed via reconcile rather than confirm; otherwise it's a
   * standalone receipt that creates its transaction at confirm.
   */
  async createFromUpload(
    userId: string,
    uploads: { buffer: Buffer; originalName: string | null }[],
    transactionId: string | null = null,
  ): Promise<ReceiptResponseDto> {
    if (uploads.length === 0 || uploads.length > RECEIPT_MAX_FILES) {
      throw new BadRequestException({
        message: `A receipt takes 1–${RECEIPT_MAX_FILES} files`,
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_FILE_TYPE,
      });
    }
    if (transactionId) await this.assertAttachableTransaction(userId, transactionId);

    // Validate + persist every page first; a mixed batch aborts before any
    // DB row exists (stored pages of the aborted batch are removed).
    const saved: { fileRef: string; mimeType: string; sizeBytes: number }[] = [];
    try {
      for (const upload of uploads) {
        saved.push(await this.storage.save(upload.buffer));
      }
      if (saved.length > 1 && saved.some((s) => s.mimeType === 'application/pdf')) {
        throw new BadRequestException({
          message: 'A PDF receipt is a single file — upload it alone',
          errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_FILE_TYPE,
        });
      }
    } catch (err) {
      await Promise.all(saved.map((s) => this.storage.delete(s.fileRef)));
      throw err;
    }

    const totalBytes = saved.reduce((sum, s) => sum + s.sizeBytes, 0);
    const row = await this.prisma.receipt.create({
      data: {
        status: 'UPLOADED',
        source: 'upload',
        originalName: uploads[0].originalName?.slice(0, 255) ?? null,
        uploadedById: userId,
        ...(transactionId ? { transactionId } : {}),
        files: {
          create: saved.map((s, index) => ({
            position: index + 1,
            fileRef: s.fileRef,
            mimeType: s.mimeType,
            sizeBytes: s.sizeBytes,
          })),
        },
      },
      include: RECEIPT_INCLUDE,
    });

    await this.enqueueExtraction(row.id);
    void this.writeAudit(userId, row.id, transactionId ? 'RECEIPT_ATTACHED' : 'RECEIPT_UPLOADED', {
      pages: saved.length,
      mimeType: saved[0].mimeType,
      sizeBytes: totalBytes,
      ...(transactionId ? { transactionId } : {}),
    });
    this.logger.log(
      `Receipt ${row.id} uploaded by user ${userId} ` +
        `(${saved.length} page(s), ${saved[0].mimeType})` +
        (transactionId ? ` → attached to transaction ${transactionId}` : ''),
    );

    const dto = mapReceiptToDto(row as ReceiptWithRelations);
    this.publishUpdated(userId, dto);
    return dto;
  }

  /**
   * POST /receipts/url — online receipt by URL. `transactionId` attaches it to an
   * existing transaction (Phase 8.15, `POST /transactions/:id/receipt-url`).
   */
  async createFromUrl(
    userId: string,
    dto: CreateReceiptUrlDto,
    transactionId: string | null = null,
  ): Promise<ReceiptResponseDto> {
    // Reject non-public targets up front (SSRF guard); the fetcher re-checks
    // every redirect hop before the worker downloads anything.
    try {
      assertPublicReceiptUrl(dto.url);
    } catch (err) {
      if (err instanceof UnsafeReceiptUrlError) {
        throw new BadRequestException({
          message: err.message,
          errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_URL,
        });
      }
      throw err;
    }

    if (transactionId) await this.assertAttachableTransaction(userId, transactionId);
    const row = await this.prisma.receipt.create({
      data: {
        status: 'UPLOADED',
        source: 'url',
        sourceUrl: dto.url,
        uploadedById: userId,
        ...(transactionId ? { transactionId } : {}),
      },
      include: RECEIPT_INCLUDE,
    });

    await this.enqueueExtraction(row.id);
    void this.writeAudit(userId, row.id, transactionId ? 'RECEIPT_ATTACHED' : 'RECEIPT_UPLOADED', {
      sourceUrl: dto.url,
      ...(transactionId ? { transactionId } : {}),
    });
    this.logger.log(
      `Receipt ${row.id} created from URL by user ${userId}` +
        (transactionId ? ` → attached to transaction ${transactionId}` : ''),
    );

    const out = mapReceiptToDto(row as ReceiptWithRelations);
    this.publishUpdated(userId, out);
    return out;
  }

  /**
   * POST /receipts/manual — a receipt composed by scanning product barcodes
   * (Phase 8.14). No extraction job runs (the user IS the extractor): the
   * receipt is born in REVIEW with every line pre-linked to its registry
   * product (matchStatus CONFIRMED, stage `barcode`, confidence 1.0) and
   * totals summed server-side. Review → confirm then creates the transaction
   * exactly like any other receipt.
   */
  async createManual(userId: string, dto: CreateManualReceiptDto): Promise<ReceiptResponseDto> {
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, brand: true, defaultCategoryId: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = productIds.filter((pid) => !byId.has(pid));
    if (missing.length > 0) {
      throw new NotFoundException({
        message: `Unknown products: ${missing.join(', ')}`,
        errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
      });
    }

    const purchasedAt = dto.purchasedAt ? new Date(dto.purchasedAt) : new Date();
    const lines = dto.items.map((item, index) => {
      const product = byId.get(item.productId)!;
      return {
        position: index + 1,
        rawName: product.name.slice(0, 300),
        quantity: new Prisma.Decimal(item.quantity.toFixed(3)),
        unitPriceCents: item.unitPriceCents,
        discountCents: 0,
        totalCents: Math.round(item.quantity * item.unitPriceCents),
        categoryId: product.defaultCategoryId,
        productId: product.id,
        matchStatus: 'CONFIRMED',
        matchCandidates: [
          {
            productId: product.id,
            name: product.name,
            brand: product.brand,
            stage: 'barcode',
            confidence: 1,
          },
        ] as Prisma.InputJsonValue,
        purchasedAt,
      };
    });

    const row = await this.prisma.receipt.create({
      data: {
        status: 'REVIEW',
        source: 'manual',
        extractedMerchantName: dto.merchantName?.trim().slice(0, 200) || null,
        purchasedAt,
        currency: dto.currency.toUpperCase(),
        totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
        uploadedById: userId,
        items: { create: lines },
      },
      include: RECEIPT_INCLUDE,
    });

    void this.writeAudit(userId, row.id, 'RECEIPT_MANUAL_CREATED', {
      items: lines.length,
      totalCents: row.totalCents,
      currency: row.currency,
    });
    this.logger.log(
      `Receipt ${row.id} composed manually by user ${userId} (${lines.length} items)`,
    );

    const out = mapReceiptToDto(row as ReceiptWithRelations);
    this.publishUpdated(userId, out);
    return out;
  }

  /** GET /receipts — uploader's receipts, newest first, cursor-paginated. */
  async list(userId: string, q: ListReceiptsQueryDto): Promise<ReceiptListResponse> {
    const limit = q.limit ?? PAGINATION_DEFAULTS.DEFAULT_LIMIT;

    let cursorFilter: Prisma.ReceiptWhereInput | undefined;
    if (q.cursor) {
      let payload: Record<string, unknown>;
      try {
        payload = decodeCursor(q.cursor);
      } catch {
        throw new BadRequestException({
          message: 'Invalid cursor',
          errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
        });
      }
      const createdAt = new Date(String(payload.createdAt));
      const id = String(payload.id ?? '');
      if (Number.isNaN(createdAt.getTime()) || !id) {
        throw new BadRequestException({
          message: 'Invalid cursor',
          errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
        });
      }
      cursorFilter = {
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
      };
    }

    const rows = await this.prisma.receipt.findMany({
      where: {
        uploadedById: userId,
        ...(q.status ? { status: q.status } : {}),
        ...(cursorFilter ?? {}),
      },
      include: RECEIPT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      data: slice.map((r) => mapReceiptToDto(r as ReceiptWithRelations)),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
      hasMore,
    };
  }

  /** GET /receipts/:id */
  async getOne(userId: string, id: string): Promise<ReceiptResponseDto> {
    const row = await this.loadViewableOrThrow(userId, id);
    return mapReceiptToDto(row);
  }

  /** GET /receipts/:id/files/:fileId — stream one page (8.22). */
  async openFile(
    userId: string,
    id: string,
    fileId: string,
  ): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; sizeBytes: number }> {
    const row = await this.loadViewableOrThrow(userId, id);
    const file = row.files.find((f) => f.id === fileId);
    if (!file) {
      throw new NotFoundException({
        message: 'Receipt has no such stored file',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
    const { stream, sizeBytes } = await this.storage.openStream(file.fileRef);
    return { stream, mimeType: file.mimeType, sizeBytes };
  }

  /** POST /receipts/:id/retry — FAILED → back through the pipeline. */
  async retry(userId: string, id: string): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, id);
    // Manual receipts never ran extraction — nothing to retry (8.14).
    if (row.source === 'manual') {
      throw new BadRequestException({
        message: 'Manually composed receipts have no extraction to retry',
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }
    if (row.status !== 'FAILED') {
      throw new BadRequestException({
        message: `Only FAILED receipts can be retried (status: ${row.status})`,
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }
    const updated = await this.prisma.receipt.update({
      where: { id: row.id },
      data: { status: 'UPLOADED', failureReason: null },
      include: RECEIPT_INCLUDE,
    });
    await this.enqueueExtraction(row.id);
    void this.writeAudit(userId, row.id, 'RECEIPT_RETRIED', {});

    const dto = mapReceiptToDto(updated as ReceiptWithRelations);
    this.publishUpdated(userId, dto);
    return dto;
  }

  /** DELETE /receipts/:id — any non-confirmed state. */
  async remove(userId: string, id: string): Promise<void> {
    const row = await this.loadOwnedOrThrow(userId, id);
    if (row.status === 'CONFIRMED') {
      throw new BadRequestException({
        message: 'Confirmed receipts are managed through their transaction',
        errorCode: RECEIPT_ERRORS.RECEIPT_ALREADY_CONFIRMED,
      });
    }
    await this.prisma.receipt.delete({ where: { id: row.id } }); // items + files cascade
    await Promise.all(row.files.map((file) => this.storage.delete(file.fileRef)));
    void this.writeAudit(userId, row.id, 'RECEIPT_DELETED', { status: row.status });
    this.logger.log(`Receipt ${row.id} deleted by user ${userId}`);
    this.publishDeleted(userId, row.id);
  }

  /** PATCH /receipts/:id — REVIEW-only header corrections (Phase 7.8). */
  async update(userId: string, id: string, dto: UpdateReceiptDto): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, id);
    this.assertInReview(row.status);

    const data: Prisma.ReceiptUpdateInput = {};
    if (dto.extractedMerchantName !== undefined) {
      data.extractedMerchantName = dto.extractedMerchantName?.trim() || null;
    }
    if (dto.merchantId !== undefined) {
      if (dto.merchantId === null) {
        data.merchant = { disconnect: true };
      } else {
        const merchant = await this.prisma.merchant.findUnique({ where: { id: dto.merchantId } });
        if (!merchant) {
          throw new NotFoundException({
            message: 'Merchant not found',
            errorCode: RECEIPT_ERRORS.MERCHANT_NOT_FOUND,
          });
        }
        data.merchant = { connect: { id: merchant.id } };
      }
    }
    if (dto.purchasedAt !== undefined) {
      data.purchasedAt = dto.purchasedAt === null ? null : new Date(dto.purchasedAt);
    }
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.totalCents !== undefined) data.totalCents = dto.totalCents;
    if (dto.discountCents !== undefined) data.discountCents = dto.discountCents;

    const updated = await this.prisma.receipt.update({
      where: { id: row.id },
      data,
      include: RECEIPT_INCLUDE,
    });
    // Keep the denormalized item purchase date in sync (Phase 8, design §2).
    if (dto.purchasedAt !== undefined) {
      await this.prisma.receiptItem.updateMany({
        where: { receiptId: row.id },
        data: { purchasedAt: updated.purchasedAt ?? updated.createdAt },
      });
    }
    void this.writeAudit(userId, row.id, 'RECEIPT_UPDATED', { changed: Object.keys(data) });

    const out = mapReceiptToDto(updated as ReceiptWithRelations);
    this.publishUpdated(userId, out);
    return out;
  }

  /** PUT /receipts/:id/items — REVIEW-only full replacement (Phase 7.8). */
  async replaceItems(
    userId: string,
    id: string,
    dto: ReplaceItemsDto,
  ): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, id);
    this.assertInReview(row.status);

    // Every referenced category must be visible to the uploader and
    // OUT-compatible — same rule the extraction worker applies.
    const categoryIds = [
      ...new Set(dto.items.map((i) => i.categoryId).filter((c): c is string => !!c)),
    ];
    if (categoryIds.length > 0) {
      const visible = await this.categoryService.list(userId, { direction: 'OUT' });
      const visibleIds = new Set(visible.map((c) => c.id));
      const invalid = categoryIds.filter((c) => !visibleIds.has(c));
      if (invalid.length > 0) {
        throw new BadRequestException({
          message: `Unknown or inaccessible categories: ${invalid.join(', ')}`,
          errorCode: RECEIPT_ERRORS.RECEIPT_ITEMS_INVALID,
        });
      }
    }

    // Replacement is content-level; product-match state (Phase 8) is
    // carried over for lines whose name is unchanged — an edited name
    // invalidates its match by definition. Exact (position, name) pairs
    // win; leftover same-name rows cover reordered lines.
    type MatchCarry = Pick<
      (typeof row.items)[number],
      'productId' | 'matchStatus' | 'matchCandidates' | 'barcode'
    >;
    const byPositionAndName = new Map<string, MatchCarry>();
    const byName = new Map<string, MatchCarry[]>();
    for (const item of row.items) {
      const name = item.rawName.trim();
      byPositionAndName.set(`${item.position}:${name}`, item);
      const list = byName.get(name) ?? [];
      list.push(item);
      byName.set(name, list);
    }
    const consumed = new Set<MatchCarry>();
    const carryFor = (position: number, name: string): MatchCarry | null => {
      const exact = byPositionAndName.get(`${position}:${name}`);
      if (exact && !consumed.has(exact)) {
        consumed.add(exact);
        return exact;
      }
      const fallback = (byName.get(name) ?? []).find((c) => !consumed.has(c));
      if (fallback) {
        consumed.add(fallback);
        return fallback;
      }
      return null;
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.receiptItem.deleteMany({ where: { receiptId: row.id } });
      if (dto.items.length > 0) {
        await tx.receiptItem.createMany({
          data: dto.items.map((item, index) => {
            const rawName = item.rawName.trim().slice(0, 300);
            const carry = carryFor(index + 1, rawName);
            return {
              receiptId: row.id,
              position: index + 1,
              rawName,
              barcode: carry?.barcode ?? null,
              quantity: new Prisma.Decimal(item.quantity.toFixed(3)),
              unitPriceCents: item.unitPriceCents ?? null,
              discountCents: item.discountCents ?? 0,
              totalCents: item.totalCents,
              categoryId: item.categoryId ?? null,
              productId: carry?.productId ?? null,
              matchStatus: carry?.matchStatus ?? 'PENDING',
              matchCandidates:
                carry && carry.matchCandidates !== null
                  ? (carry.matchCandidates as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
              purchasedAt: row.purchasedAt ?? row.createdAt,
            };
          }),
        });
      }
    });
    void this.writeAudit(userId, row.id, 'RECEIPT_ITEMS_REPLACED', { items: dto.items.length });

    const fresh = await this.prisma.receipt.findUnique({
      where: { id: row.id },
      include: RECEIPT_INCLUDE,
    });
    const out = mapReceiptToDto(fresh as ReceiptWithRelations);
    this.publishUpdated(userId, out);
    return out;
  }

  /** GET /merchants?search= — global registry lookup (Phase 7.8). */
  async searchMerchants(search: string): Promise<{ id: string; name: string }[]> {
    const normalized = normalizeLookupName(search);
    if (!normalized) return [];
    const rows = await this.prisma.merchant.findMany({
      where: { normalizedName: { contains: normalized } },
      orderBy: { normalizedName: 'asc' },
      take: 10,
      select: { id: true, name: true },
    });
    return rows;
  }

  /**
   * POST /receipts/:id/confirm — turn a reviewed receipt into a transaction
   * (Phase 7.9). Creates one `Transaction` (OUT / ONE_TIME) with the caller's
   * remembered attribution scopes, attaches the stored file as a
   * `TransactionDocument` (kind `receipt`), links the receipt to the transaction,
   * and creates the merchant in the global registry when the review named
   * one that isn't linked yet. Transaction, document, and the receipt→transaction
   * link all commit in one transaction so a CONFIRMED receipt always points
   * at a real transaction (no orphans, no double-confirm).
   */
  async confirm(userId: string, id: string, dto: ConfirmReceiptDto): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, id);
    this.assertInReview(row.status);

    // A receipt already attached to a transaction (Phase 8.15) is finished via
    // reconcile — confirm would try to create a second transaction.
    if (row.transactionId) {
      throw new BadRequestException({
        message: 'This receipt is attached to a transaction; reconcile it instead of confirming',
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }

    // A transaction needs an amount + currency; the review step fills these in.
    if (row.totalCents === null || row.totalCents <= 0) {
      throw new BadRequestException({
        message: 'Receipt total is required before confirmation',
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }
    if (!row.currency) {
      throw new BadRequestException({
        message: 'Receipt currency is required before confirmation',
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }
    const amountCents = row.totalCents;
    const currency = row.currency;
    // Fall back to the upload time when no purchase date was extracted/entered.
    const occurredAt = row.purchasedAt ?? row.createdAt;

    // Validate the transaction inputs (category visibility + OUT direction,
    // attributions, amount, currency, date) up front — reads only.
    await this.transactionService.validateExpenseInputs(userId, {
      amountCents,
      currency,
      occurredAt: occurredAt.toISOString(),
      categoryId: dto.categoryId,
      attributions: dto.attributions,
    });

    const merchantName = row.merchant?.name ?? row.extractedMerchantName ?? null;
    const note = dto.note?.trim() || merchantName;

    const { transaction, merchantId, merchantCreated } = await this.prisma.$transaction(
      async (tx) => {
        // Resolve the merchant: keep an existing link, otherwise create/find
        // one in the global registry from the reviewed name.
        let resolvedMerchantId = row.merchantId;
        let created = false;
        const rawName = row.extractedMerchantName?.trim();
        if (!resolvedMerchantId && rawName) {
          const name = rawName.slice(0, 200);
          const normalizedName = normalizeLookupName(name);
          if (normalizedName) {
            const existing = await tx.merchant.findUnique({ where: { normalizedName } });
            if (existing) {
              resolvedMerchantId = existing.id;
            } else {
              const merchant = await tx.merchant.create({ data: { name, normalizedName } });
              resolvedMerchantId = merchant.id;
              created = true;
            }
          }
        }

        const transaction = await this.transactionService.createExpenseWithinTx(tx, userId, {
          amountCents,
          currency,
          occurredAt,
          categoryId: dto.categoryId,
          note: note ?? null,
          attributions: dto.attributions,
          // One document row per stored page (8.22) — the panel renders the
          // receipt itself; these rows are the audit/`hasDocuments` trail.
          documents: row.files.map((file) => ({
            kind: 'receipt',
            fileRef: file.fileRef,
            originalName: row.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
          })),
        });

        await tx.receipt.update({
          where: { id: row.id },
          data: {
            status: 'CONFIRMED',
            transactionId: transaction.id,
            ...(resolvedMerchantId && resolvedMerchantId !== row.merchantId
              ? { merchantId: resolvedMerchantId }
              : {}),
          },
        });
        // Freeze the denormalized purchase date to the transaction's date — the
        // (product_id, purchased_at) price-history key (Phase 8, design §2).
        await tx.receiptItem.updateMany({
          where: { receiptId: row.id },
          data: { purchasedAt: occurredAt },
        });

        return { transaction, merchantId: resolvedMerchantId, merchantCreated: created };
      },
    );

    void this.writeAudit(userId, row.id, 'RECEIPT_CONFIRMED', {
      transactionId: transaction.id,
      amountCents,
      currency,
      merchantId,
    });
    if (merchantCreated && merchantId) {
      void this.writeAudit(
        userId,
        merchantId,
        'MERCHANT_CREATED',
        { name: merchantName },
        'Merchant',
      );
    }

    // Fan out the new transaction (all recipients) and the now-CONFIRMED receipt
    // (the uploader) — both post-commit.
    await this.transactionService.publishCreated(transaction);
    const fresh = await this.prisma.receipt.findUnique({
      where: { id: row.id },
      include: RECEIPT_INCLUDE,
    });
    const out = mapReceiptToDto(fresh as ReceiptWithRelations);
    this.publishUpdated(userId, out);

    this.logger.log(
      `Receipt ${row.id} confirmed by user ${userId} → transaction ${transaction.id}`,
    );
    return out;
  }

  /**
   * POST /receipts/:id/reconcile — the confirm step for a receipt attached to
   * an existing transaction (Phase 8.15, design §3). Flips REVIEW → CONFIRMED
   * WITHOUT creating a transaction, and — per the flags — overwrites the linked
   * transaction's amount/currency and/or category from the reviewed receipt.
   * Item/product links are kept regardless of the flags; only the transaction
   * header is up for negotiation. The transaction mutation goes through
   * {@link TransactionService.update} so category/currency validation, audit, and
   * realtime fan-out all match a normal edit.
   */
  async reconcile(
    userId: string,
    id: string,
    dto: ReconcileReceiptDto,
  ): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, id);
    this.assertInReview(row.status);
    if (!row.transactionId) {
      throw new BadRequestException({
        message: 'Receipt is not attached to a transaction',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_ATTACHED,
      });
    }

    const patch: UpdateTransactionDto = {};
    if (dto.applyTotal) {
      if (row.totalCents === null || row.totalCents <= 0) {
        throw new BadRequestException({
          message: 'Receipt total is required to apply it to the transaction',
          errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
        });
      }
      patch.amountCents = row.totalCents;
      // Applying the total also applies the receipt's currency (design §3).
      if (row.currency) patch.currency = row.currency;
    }
    if (dto.applyCategory) {
      const categoryId = dominantReceiptCategoryId(
        row.items.map((i) => ({ categoryId: i.categoryId, totalCents: i.totalCents })),
      );
      if (categoryId) patch.categoryId = categoryId;
    }

    // Apply the chosen transaction changes first (validates + audits + publishes).
    // A validation failure here leaves the receipt in REVIEW to retry.
    if (Object.keys(patch).length > 0) {
      await this.transactionService.update(userId, row.transactionId, patch);
    }

    // Flip the receipt to CONFIRMED and freeze the item purchase date to the
    // transaction's — the (product_id, purchased_at) price-history key (design §2).
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: row.transactionId },
      select: { occurredAt: true },
    });
    const occurredAt = transaction?.occurredAt ?? row.purchasedAt ?? row.createdAt;
    await this.prisma.$transaction(async (tx) => {
      await tx.receipt.update({ where: { id: row.id }, data: { status: 'CONFIRMED' } });
      await tx.receiptItem.updateMany({
        where: { receiptId: row.id },
        data: { purchasedAt: occurredAt },
      });
    });

    void this.writeAudit(userId, row.id, 'RECEIPT_RECONCILED', {
      transactionId: row.transactionId,
      appliedTotal: dto.applyTotal,
      appliedCategory: dto.applyCategory,
      ...(patch.amountCents !== undefined ? { amountCents: patch.amountCents } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
    });
    this.logger.log(
      `Receipt ${row.id} reconciled by user ${userId} → transaction ${row.transactionId} ` +
        `(total=${dto.applyTotal}, category=${dto.applyCategory})`,
    );

    return this.refresh(userId, row.id);
  }

  /**
   * POST /receipts/:id/items/:itemId/match — the walkthrough confirm
   * (Phase 8.4/8.5). Links the item to a registry product (existing or
   * created in the same call), records the raw spelling as an alias with
   * the confirmer's locale (registry auto-update, design §1.3), and
   * optionally overrides the item category. Allowed in REVIEW and
   * CONFIRMED — matching after transaction creation is still valuable.
   */
  async matchItem(
    userId: string,
    receiptId: string,
    itemId: string,
    dto: MatchItemDto,
  ): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, receiptId);
    this.assertMatchable(row.status);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException({
        message: 'Receipt item not found',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
    if (!dto.productId === !dto.createProduct) {
      throw new BadRequestException({
        message: 'Provide exactly one of productId / createProduct',
        errorCode: PRODUCT_ERRORS.PRODUCT_MATCH_INVALID,
      });
    }
    if (dto.categoryId) {
      const visible = await this.categoryService.list(userId, { direction: 'OUT' });
      if (!visible.some((c) => c.id === dto.categoryId)) {
        throw new BadRequestException({
          message: 'Unknown or inaccessible category',
          errorCode: RECEIPT_ERRORS.RECEIPT_ITEMS_INVALID,
        });
      }
    }

    // Resolve the registry product. Creation publishes globally and is
    // audited by ProductService; a stale-id link 404s cleanly.
    let productId: string;
    if (dto.createProduct) {
      const created = await this.productService.create(userId, dto.createProduct);
      productId = created.id;
    } else {
      const exists = await this.prisma.product.findUnique({
        where: { id: dto.productId! },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException({
          message: 'Product not found',
          errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
        });
      }
      productId = exists.id;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.receiptItem.update({
        where: { id: item.id },
        data: {
          productId,
          matchStatus: 'CONFIRMED',
          ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        },
      });
      await this.productService.recordAlias(
        tx,
        userId,
        productId,
        item.rawName,
        user?.locale ?? null,
        'confirmation',
      );
      // 8.21 — a confirmed link teaches the registry the printed barcode,
      // exactly like a manual scan would: only onto a product that has none,
      // and only when no other product owns the code (barcode is unique).
      if (item.barcode) {
        const [owner, target] = await Promise.all([
          tx.product.findUnique({ where: { barcode: item.barcode }, select: { id: true } }),
          tx.product.findUnique({ where: { id: productId }, select: { barcode: true } }),
        ]);
        if (!owner && target && !target.barcode) {
          await tx.product.update({
            where: { id: productId },
            data: { barcode: item.barcode },
          });
        }
      }
    });
    void this.writeAudit(userId, row.id, 'RECEIPT_ITEM_MATCHED', {
      itemId: item.id,
      productId,
      created: !!dto.createProduct,
    });

    return this.refresh(userId, row.id);
  }

  /** POST /receipts/:id/items/:itemId/skip-match — resumable skip/unlink. */
  async skipItemMatch(
    userId: string,
    receiptId: string,
    itemId: string,
  ): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, receiptId);
    this.assertMatchable(row.status);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException({
        message: 'Receipt item not found',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
    await this.prisma.receiptItem.update({
      where: { id: item.id },
      data: { productId: null, matchStatus: 'SKIPPED' },
    });
    return this.refresh(userId, row.id);
  }

  /** Walkthrough is available while reviewing and after confirmation. */
  private assertMatchable(status: string): void {
    if (status !== 'REVIEW' && status !== 'CONFIRMED') {
      throw new BadRequestException({
        message: `Receipt items can be matched in REVIEW or CONFIRMED (status: ${status})`,
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }
  }

  /** Reload + map + fan out — shared tail of the walkthrough mutations. */
  private async refresh(userId: string, receiptId: string): Promise<ReceiptResponseDto> {
    const fresh = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: RECEIPT_INCLUDE,
    });
    const out = mapReceiptToDto(fresh as ReceiptWithRelations);
    this.publishUpdated(userId, out);
    return out;
  }

  private assertInReview(status: string): void {
    if (status !== 'REVIEW') {
      throw new BadRequestException({
        message: `Receipt must be in REVIEW to edit (status: ${status})`,
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Guard for attaching a receipt to an existing transaction (Phase 8.15). The
   * transaction must be an expense (OUT) the caller created, and must not already
   * carry a receipt (`receipts.transaction_id` is unique). Missing/foreign
   * transactions read as 404 — no existence leak (the Phase 6 convention).
   */
  private async assertAttachableTransaction(userId: string, transactionId: string): Promise<void> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, createdById: userId },
      select: { id: true, direction: true },
    });
    if (!transaction) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
    if (transaction.direction !== 'OUT') {
      throw new BadRequestException({
        message: 'Receipts can only be attached to expense transactions',
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_STATE,
      });
    }
    const existing = await this.prisma.receipt.findUnique({
      where: { transactionId },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        message: 'This transaction already has a receipt',
        errorCode: RECEIPT_ERRORS.TRANSACTION_ALREADY_HAS_RECEIPT,
      });
    }
  }

  private async loadOwnedOrThrow(userId: string, id: string): Promise<ReceiptWithRelations> {
    const row = await this.prisma.receipt.findFirst({
      where: { id, uploadedById: userId },
      include: RECEIPT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        message: 'Receipt not found',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
    return row as ReceiptWithRelations;
  }

  /**
   * Phase 8.19 — read access for VIEW paths (getOne, openFile). A receipt is
   * a transaction's proving document, so anyone who can see the linked transaction may
   * view it and download its file — the uploader, or a member of the group the
   * transaction is attributed to (delegated to `TransactionService.assertVisible`).
   * Mutations keep `loadOwnedOrThrow` (uploader-only). A receipt the caller
   * can neither own nor reach via its transaction 404s, same as the owned lookup.
   */
  private async loadViewableOrThrow(userId: string, id: string): Promise<ReceiptWithRelations> {
    const row = await this.prisma.receipt.findFirst({ where: { id }, include: RECEIPT_INCLUDE });
    if (row) {
      if (row.uploadedById === userId) return row as ReceiptWithRelations;
      if (row.transactionId) {
        const visible = await this.transactionService
          .assertVisible(userId, row.transactionId)
          .then(() => true)
          .catch((err) => {
            if (err instanceof NotFoundException) return false;
            throw err;
          });
        if (visible) return row as ReceiptWithRelations;
      }
    }
    throw new NotFoundException({
      message: 'Receipt not found',
      errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
    });
  }

  /**
   * Enqueue the extraction job. Job ids carry a timestamp so a retry after
   * a completed (failed) job is not deduplicated away by BullMQ; the 7.6
   * worker's status guard makes duplicate fires no-ops.
   */
  private async enqueueExtraction(receiptId: string): Promise<void> {
    await this.queue.add(
      'extract',
      { receiptId },
      {
        jobId: `receipt:${receiptId}:${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }

  /** Best-effort realtime fan-out to the uploader (never breaks the op). */
  private publishUpdated(userId: string, receipt: ReceiptResponseDto): void {
    try {
      this.eventBus.publish({ type: 'receipt.updated', userIds: [userId], receipt });
    } catch (err) {
      this.logger.warn(
        `Failed to publish receipt.updated for ${receipt.id}: ${(err as Error).message}`,
      );
    }
  }

  private publishDeleted(userId: string, receiptId: string): void {
    try {
      this.eventBus.publish({ type: 'receipt.deleted', userIds: [userId], receiptId });
    } catch (err) {
      this.logger.warn(
        `Failed to publish receipt.deleted for ${receiptId}: ${(err as Error).message}`,
      );
    }
  }

  private async writeAudit(
    userId: string,
    entityId: string,
    action: string,
    details: Record<string, unknown>,
    entity: 'Receipt' | 'Merchant' = 'Receipt',
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity,
          entityId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write ${action} audit log for ${entity.toLowerCase()} ${entityId}: ${(err as Error).message}`,
      );
    }
  }
}
