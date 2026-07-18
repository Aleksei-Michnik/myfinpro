import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPT_OPTIMIZATIONS_QUEUE } from '../queue/queue.constants';
import { ReceiptStorageService } from './receipt-storage.service';

/**
 * 2048px keeps the document comfortably legible under the viewer's zoom —
 * it remains the transaction's proving document (design §3.6).
 */
const OPTIMIZED_MAX_EDGE = 2048;
const OPTIMIZED_WEBP_QUALITY = 80;

/** Page types worth re-encoding; PDFs and WebP pages are left alone. */
const OPTIMIZABLE_MIME_TYPES = ['image/jpeg', 'image/png'];

/** Stagger for the bootstrap backfill sweep. */
const BACKFILL_STAGGER_MS = 5_000;

export interface ReceiptOptimizationJob {
  receiptId: string;
}

/**
 * Phase 8.25 — receipt storage compaction (design §3.6). Runs only after
 * REVIEW → CONFIRMED: the status machine guarantees extraction never reads
 * the pages again (retry exists only for FAILED → UPLOADED), so the
 * original stays model-grade for its whole extraction-relevant life.
 * Re-encoding also strips EXIF/GPS from stored receipt photos.
 */
@Injectable()
export class ReceiptOptimizationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReceiptOptimizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ReceiptStorageService,
    @InjectQueue(RECEIPT_OPTIMIZATIONS_QUEUE)
    private readonly queue: Queue<ReceiptOptimizationJob>,
  ) {}

  /**
   * Self-healing backfill: receipts confirmed before 8.25 shipped still
   * hold their original pages. One staggered pass per boot; jobs dedup on
   * a stable jobId, and an already-optimized receipt is a fast no-op.
   */
  onApplicationBootstrap(): void {
    void this.enqueueBackfill().catch((err: Error) =>
      this.logger.warn(`Receipt optimization backfill enqueue failed: ${err.message}`),
    );
  }

  /** Fire-and-forget from the two REVIEW → CONFIRMED choke points. */
  async enqueue(receiptId: string): Promise<void> {
    await this.queue.add(
      'optimize',
      { receiptId },
      {
        // Dash-separated: BullMQ rejects custom ids containing ':'.
        jobId: `receipt-optimize-${receiptId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }

  /**
   * Worker entry: re-encode every jpeg/png page of a CONFIRMED receipt to
   * ≤2048px WebP q80. A result not smaller than the original is discarded
   * (keep-original guard). The `receipt_files` row and every
   * `transaction_documents` row sharing the old fileRef move together in
   * one transaction — confirm copies page fileRefs onto document rows.
   */
  async optimize(receiptId: string): Promise<{ optimized: number }> {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      select: { id: true, status: true, files: { orderBy: { position: 'asc' } } },
    });
    // Only CONFIRMED receipts are safe (design §3.6); a vanished or
    // still-open receipt is a no-op, not an error.
    if (!receipt || receipt.status !== 'CONFIRMED') return { optimized: 0 };

    let optimized = 0;
    for (const file of receipt.files) {
      if (!OPTIMIZABLE_MIME_TYPES.includes(file.mimeType)) continue;

      const original = await this.storage.read(file.fileRef);
      const encoded = await sharp(original)
        .rotate()
        .resize(OPTIMIZED_MAX_EDGE, OPTIMIZED_MAX_EDGE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: OPTIMIZED_WEBP_QUALITY })
        .toBuffer();
      if (encoded.length >= original.length) {
        this.logger.log(
          `Receipt ${receiptId} page ${file.position}: WebP not smaller ` +
            `(${original.length} → ${encoded.length} bytes) — keeping original`,
        );
        continue;
      }

      const saved = await this.storage.save(encoded);
      await this.prisma.$transaction(async (tx) => {
        await tx.receiptFile.update({
          where: { id: file.id },
          data: { fileRef: saved.fileRef, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes },
        });
        await tx.transactionDocument.updateMany({
          where: { fileRef: file.fileRef },
          data: { fileRef: saved.fileRef, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes },
        });
      });
      await this.storage.delete(file.fileRef);
      optimized++;
      this.logger.log(
        `Receipt ${receiptId} page ${file.position}: ${file.mimeType} ${original.length} → ` +
          `webp ${encoded.length} bytes`,
      );
    }
    return { optimized };
  }

  private async enqueueBackfill(): Promise<void> {
    const rows = await this.prisma.receipt.findMany({
      where: {
        status: 'CONFIRMED',
        files: { some: { mimeType: { in: OPTIMIZABLE_MIME_TYPES } } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const [index, row] of rows.entries()) {
      await this.queue.add(
        'optimize',
        { receiptId: row.id },
        {
          jobId: `receipt-optimize-${row.id}`,
          delay: index * BACKFILL_STAGGER_MS,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }
    if (rows.length > 0) {
      this.logger.log(`Receipt optimization backfill: ${rows.length} receipt(s) enqueued`);
    }
  }
}
