import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_IMAGES_QUEUE } from '../queue/queue.constants';
import { ProductImageService, type ProductImageJob } from './product-image.service';

/**
 * Phase 8.25 (evolved from 8.8) — the product-image worker. Writes the
 * four renditions (WebP + AVIF × detail + thumb) at the row's immutable
 * `baseRef` and cleans up the staged original. A vanished row makes the
 * job a no-op (pictures can be removed while a job waits).
 */
@Processor(PRODUCT_IMAGES_QUEUE)
export class ProductImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductImageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ProductImageService,
  ) {
    super();
  }

  async process(job: Job<ProductImageJob>): Promise<{ processed: boolean }> {
    const data = job.data;
    const row = await this.prisma.productImage.findUnique({
      where: { id: data.productImageId },
      select: { id: true, baseRef: true },
    });
    if (!row) {
      this.logger.warn(`[orphan] product image ${data.productImageId} not found — skipping job`);
      if (data.kind === 'staged') await this.images.delete(data.stagedRef);
      return { processed: false };
    }

    let succeeded = false;
    try {
      await this.images.process(data, row.baseRef);
      succeeded = true;
      return { processed: true };
    } finally {
      // Retries re-read the staged original, so it is cleaned up only once
      // consumed: on success, or when the final attempt failed too.
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (data.kind === 'staged' && (succeeded || isFinalAttempt)) {
        await this.images.delete(data.stagedRef);
      }
    }
  }
}
