import { decodeCursor, encodeCursor, PAGINATION_DEFAULTS } from '@myfinpro/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPT_EXTRACTIONS_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { RECEIPT_ERRORS } from './constants/receipt-errors';
import { CreateReceiptUrlDto } from './dto/create-receipt-url.dto';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto';
import {
  mapReceiptToDto,
  ReceiptResponseDto,
  type ReceiptWithRelations,
} from './dto/receipt-response.dto';
import { ReplaceItemsDto } from './dto/replace-items.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { ReceiptStorageService } from './receipt-storage.service';
import { normalizeMerchantName } from './utils/merchant-name.util';

/** Include set every read path uses — items + joined merchant name. */
export const RECEIPT_INCLUDE = {
  items: true,
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

    await this.prisma.$transaction(async (tx) => {
      await tx.receiptItem.deleteMany({ where: { receiptId: row.id } });
      if (dto.items.length > 0) {
        await tx.receiptItem.createMany({
          data: dto.items.map((item, index) => ({
            receiptId: row.id,
            position: index + 1,
            rawName: item.rawName.trim().slice(0, 300),
            quantity: new Prisma.Decimal(item.quantity.toFixed(3)),
            unitPriceCents: item.unitPriceCents ?? null,
            discountCents: item.discountCents ?? 0,
            totalCents: item.totalCents,
            categoryId: item.categoryId ?? null,
          })),
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
    const normalized = normalizeMerchantName(search);
    if (!normalized) return [];
    const rows = await this.prisma.merchant.findMany({
      where: { normalizedName: { contains: normalized } },
      orderBy: { normalizedName: 'asc' },
      take: 10,
      select: { id: true, name: true },
    });
    return rows;
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
