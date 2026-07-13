import {
  decodeCursor,
  encodeCursor,
  normalizeLookupName,
  PAGINATION_DEFAULTS,
} from '@myfinpro/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { CategoryService } from '../category/category.service';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_ERRORS } from '../product/constants/product-errors';
import { ProductService } from '../product/product.service';
import { RECEIPT_EXTRACTIONS_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
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
import { ReplaceItemsDto } from './dto/replace-items.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { ReceiptStorageService } from './receipt-storage.service';
import { assertPublicReceiptUrl, UnsafeReceiptUrlError } from './utils/receipt-url-guard.util';

/** Include set every read path uses — items (+ product join) + merchant. */
export const RECEIPT_INCLUDE = {
  items: { include: { product: { select: { name: true, brand: true } } } },
  merchant: { select: { name: true } },
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
    private readonly paymentService: PaymentService,
    private readonly productService: ProductService,
    @InjectQueue(RECEIPT_EXTRACTIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /** POST /receipts — multipart upload. */
  async createFromUpload(
    userId: string,
    buffer: Buffer,
    originalName: string | null,
  ): Promise<ReceiptResponseDto> {
    const saved = await this.storage.save(buffer);
    const row = await this.prisma.receipt.create({
      data: {
        status: 'UPLOADED',
        source: 'upload',
        fileRef: saved.fileRef,
        originalName: originalName?.slice(0, 255) ?? null,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        uploadedById: userId,
      },
      include: RECEIPT_INCLUDE,
    });

    await this.enqueueExtraction(row.id);
    void this.writeAudit(userId, row.id, 'RECEIPT_UPLOADED', {
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
    });
    this.logger.log(`Receipt ${row.id} uploaded by user ${userId} (${saved.mimeType})`);

    const dto = mapReceiptToDto(row as ReceiptWithRelations);
    this.publishUpdated(userId, dto);
    return dto;
  }

  /** POST /receipts/url — online receipt by URL. */
  async createFromUrl(userId: string, dto: CreateReceiptUrlDto): Promise<ReceiptResponseDto> {
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

    const row = await this.prisma.receipt.create({
      data: {
        status: 'UPLOADED',
        source: 'url',
        sourceUrl: dto.url,
        uploadedById: userId,
      },
      include: RECEIPT_INCLUDE,
    });

    await this.enqueueExtraction(row.id);
    void this.writeAudit(userId, row.id, 'RECEIPT_UPLOADED', { sourceUrl: dto.url });
    this.logger.log(`Receipt ${row.id} created from URL by user ${userId}`);

    const out = mapReceiptToDto(row as ReceiptWithRelations);
    this.publishUpdated(userId, out);
    return out;
  }

  /**
   * POST /receipts/manual — a receipt composed by scanning product barcodes
   * (Phase 8.14). No extraction job runs (the user IS the extractor): the
   * receipt is born in REVIEW with every line pre-linked to its registry
   * product (matchStatus CONFIRMED, stage `barcode`, confidence 1.0) and
   * totals summed server-side. Review → confirm then creates the payment
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
    const row = await this.loadOwnedOrThrow(userId, id);
    return mapReceiptToDto(row);
  }

  /** GET /receipts/:id/file — stream for the authenticated download. */
  async openFile(
    userId: string,
    id: string,
  ): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; sizeBytes: number }> {
    const row = await this.loadOwnedOrThrow(userId, id);
    if (!row.fileRef) {
      throw new NotFoundException({
        message: 'Receipt has no stored file',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
    const { stream, sizeBytes } = await this.storage.openStream(row.fileRef);
    return { stream, mimeType: row.mimeType ?? 'application/octet-stream', sizeBytes };
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
        message: 'Confirmed receipts are managed through their payment',
        errorCode: RECEIPT_ERRORS.RECEIPT_ALREADY_CONFIRMED,
      });
    }
    await this.prisma.receipt.delete({ where: { id: row.id } }); // items cascade
    if (row.fileRef) await this.storage.delete(row.fileRef);
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
      'productId' | 'matchStatus' | 'matchCandidates'
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
   * POST /receipts/:id/confirm — turn a reviewed receipt into a payment
   * (Phase 7.9). Creates one `Payment` (OUT / ONE_TIME) with the caller's
   * remembered attribution scopes, attaches the stored file as a
   * `PaymentDocument` (kind `receipt`), links the receipt to the payment,
   * and creates the merchant in the global registry when the review named
   * one that isn't linked yet. Payment, document, and the receipt→payment
   * link all commit in one transaction so a CONFIRMED receipt always points
   * at a real payment (no orphans, no double-confirm).
   */
  async confirm(userId: string, id: string, dto: ConfirmReceiptDto): Promise<ReceiptResponseDto> {
    const row = await this.loadOwnedOrThrow(userId, id);
    this.assertInReview(row.status);

    // A payment needs an amount + currency; the review step fills these in.
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

    // Validate the payment inputs (category visibility + OUT direction,
    // attributions, amount, currency, date) up front — reads only.
    await this.paymentService.validateExpenseInputs(userId, {
      amountCents,
      currency,
      occurredAt: occurredAt.toISOString(),
      categoryId: dto.categoryId,
      attributions: dto.attributions,
    });

    const merchantName = row.merchant?.name ?? row.extractedMerchantName ?? null;
    const note = dto.note?.trim() || merchantName;

    const { payment, merchantId, merchantCreated } = await this.prisma.$transaction(async (tx) => {
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

      const payment = await this.paymentService.createExpenseWithinTx(tx, userId, {
        amountCents,
        currency,
        occurredAt,
        categoryId: dto.categoryId,
        note: note ?? null,
        attributions: dto.attributions,
        document: row.fileRef
          ? {
              kind: 'receipt',
              fileRef: row.fileRef,
              originalName: row.originalName,
              mimeType: row.mimeType,
              sizeBytes: row.sizeBytes,
            }
          : null,
      });

      await tx.receipt.update({
        where: { id: row.id },
        data: {
          status: 'CONFIRMED',
          paymentId: payment.id,
          ...(resolvedMerchantId && resolvedMerchantId !== row.merchantId
            ? { merchantId: resolvedMerchantId }
            : {}),
        },
      });
      // Freeze the denormalized purchase date to the payment's date — the
      // (product_id, purchased_at) price-history key (Phase 8, design §2).
      await tx.receiptItem.updateMany({
        where: { receiptId: row.id },
        data: { purchasedAt: occurredAt },
      });

      return { payment, merchantId: resolvedMerchantId, merchantCreated: created };
    });

    void this.writeAudit(userId, row.id, 'RECEIPT_CONFIRMED', {
      paymentId: payment.id,
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

    // Fan out the new payment (all recipients) and the now-CONFIRMED receipt
    // (the uploader) — both post-commit.
    await this.paymentService.publishCreated(payment);
    const fresh = await this.prisma.receipt.findUnique({
      where: { id: row.id },
      include: RECEIPT_INCLUDE,
    });
    const out = mapReceiptToDto(fresh as ReceiptWithRelations);
    this.publishUpdated(userId, out);

    this.logger.log(`Receipt ${row.id} confirmed by user ${userId} → payment ${payment.id}`);
    return out;
  }

  /**
   * POST /receipts/:id/items/:itemId/match — the walkthrough confirm
   * (Phase 8.4/8.5). Links the item to a registry product (existing or
   * created in the same call), records the raw spelling as an alias with
   * the confirmer's locale (registry auto-update, design §1.3), and
   * optionally overrides the item category. Allowed in REVIEW and
   * CONFIRMED — matching after payment creation is still valuable.
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
