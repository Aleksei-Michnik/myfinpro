import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_IMAGES_QUEUE } from '../queue/queue.constants';
import { ProductImageService, type ProductImageJob } from './product-image.service';

/**
 * Phase 8, iteration 8.8 — the product-image worker. Re-encodes the staged
 * upload (or OFF prefill URL), swaps `products.image_ref` and cleans up the
 * staged original + the replaced image. A vanished product makes the job a
 * no-op (registry rows can be deleted while a job waits).
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
    const product = await this.prisma.product.findUnique({
      where: { id: data.productId },
      select: { id: true, imageRef: true },
    });
    if (!product) {
      this.logger.warn(`[orphan] product ${data.productId} not found — skipping image job`);
      if (data.kind === 'staged') await this.images.delete(data.stagedRef);
      return { processed: false };
    }

    let succeeded = false;
    try {
      const imageRef = await this.images.process(data);
      await this.prisma.product.update({
        where: { id: product.id },
        data: { imageRef },
      });
      if (product.imageRef) await this.images.delete(product.imageRef);
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
