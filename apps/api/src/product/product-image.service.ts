import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import sharp from 'sharp';
import { PRODUCT_IMAGES_QUEUE } from '../queue/queue.constants';
import { ReceiptStorageService } from '../receipt/receipt-storage.service';
import { PRODUCT_ERRORS } from './constants/product-errors';

/** Longest edge of the processed image. */
const PROCESSED_MAX_EDGE = 512;
const PROCESSED_WEBP_QUALITY = 82;
/** Cap for OFF prefill downloads (their front images are ~50–200KB). */
const URL_FETCH_MAX_BYTES = 5 * 1024 * 1024;
const URL_FETCH_TIMEOUT_MS = 15_000;

export type ProductImageJob =
  | { productId: string; kind: 'staged'; stagedRef: string }
  | { productId: string; kind: 'url'; url: string };

/**
 * Phase 8, iteration 8.8 — product image storage + background processing
 * (design §1.5). Uploads are staged raw and re-encoded off the request
 * path: sharp auto-rotates (EXIF orientation), resizes to ≤512px and
 * re-encodes to WebP — which also strips EXIF/GPS metadata by construction.
 * Files live outside the web root under PRODUCT_IMAGE_STORAGE_DIR (default
 * `<cwd>/storage/products`), same layout + traversal guard as receipts.
 */
@Injectable()
export class ProductImageService {
  private readonly logger = new Logger(ProductImageService.name);
  private readonly root: string;

  constructor(
    configService: ConfigService,
    @InjectQueue(PRODUCT_IMAGES_QUEUE) private readonly queue: Queue<ProductImageJob>,
  ) {
    this.root = path.resolve(
      configService.get<string>('PRODUCT_IMAGE_STORAGE_DIR', '') ||
        path.join(process.cwd(), 'storage', 'products'),
    );
  }

  /** Validate + stage an uploaded buffer, then enqueue the re-encode. */
  async enqueueUpload(productId: string, buffer: Buffer): Promise<void> {
    if (buffer.length === 0) {
      throw new BadRequestException({
        message: 'Empty file',
        errorCode: PRODUCT_ERRORS.PRODUCT_INVALID_IMAGE,
      });
    }
    if (buffer.length > PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        message: `Image exceeds the ${PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`,
        errorCode: PRODUCT_ERRORS.PRODUCT_IMAGE_TOO_LARGE,
      });
    }
    // Same magic-byte sniffing as receipts; PDFs are not images.
    const mimeType = ReceiptStorageService.detectMimeType(buffer);
    if (!mimeType || mimeType === 'application/pdf') {
      throw new BadRequestException({
        message: 'Unsupported image type; allowed: JPEG, PNG, WebP, HEIC',
        errorCode: PRODUCT_ERRORS.PRODUCT_INVALID_IMAGE,
      });
    }

    const stagedRef = path.posix.join('incoming', `${randomUUID()}`);
    const absolute = this.resolveRef(stagedRef);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);
    await this.enqueue({ productId, kind: 'staged', stagedRef });
  }

  /** OFF prefill image — downloaded and processed by the worker. */
  async enqueueUrlFetch(productId: string, url: string): Promise<void> {
    if (!url.startsWith('https://')) return; // prefill URLs are https-only
    await this.enqueue({ productId, kind: 'url', url });
  }

  /**
   * Worker entry: load the source bytes, re-encode, persist. Returns the
   * new immutable imageRef; the processor owns the DB update + cleanup.
   */
  async process(job: ProductImageJob): Promise<string> {
    let source: Buffer;
    if (job.kind === 'staged') {
      source = await readFile(this.resolveRef(job.stagedRef));
    } else {
      const res = await fetch(job.url, {
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'myfinpro/1.0 (product image prefill)' },
      });
      if (!res.ok) throw new Error(`Image URL returned ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length > URL_FETCH_MAX_BYTES) throw new Error('Image URL response too large');
      source = raw;
    }

    // rotate() applies EXIF orientation; re-encoding to WebP drops all
    // metadata (EXIF/GPS) — the privacy half of this iteration.
    const processed = await sharp(source)
      .rotate()
      .resize(PROCESSED_MAX_EDGE, PROCESSED_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: PROCESSED_WEBP_QUALITY })
      .toBuffer();

    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const imageRef = path.posix.join(yyyy, mm, `${randomUUID()}.webp`);
    const absolute = this.resolveRef(imageRef);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, processed);
    this.logger.log(
      `Processed product image for ${job.productId}: ${source.length} → ${processed.length} bytes`,
    );
    return imageRef;
  }

  /** Open a processed image for the serving endpoint. 404 when missing. */
  async openStream(
    imageRef: string,
  ): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number }> {
    const absolute = this.resolveRef(imageRef);
    try {
      const info = await stat(absolute);
      return { stream: createReadStream(absolute), sizeBytes: info.size };
    } catch {
      throw new NotFoundException({
        message: 'Product image not found',
        errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
      });
    }
  }

  /** Best-effort delete (staged originals, replaced images). */
  async delete(ref: string): Promise<void> {
    try {
      await rm(this.resolveRef(ref));
    } catch (err) {
      this.logger.warn(`Failed to delete product image ${ref}: ${(err as Error).message}`);
    }
  }

  private async enqueue(job: ProductImageJob): Promise<void> {
    await this.queue.add('process', job, {
      jobId: `product-image:${job.productId}:${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  /** Same traversal guard as receipt storage — refs are server-minted. */
  private resolveRef(ref: string): string {
    const absolute = path.resolve(this.root, ref);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) {
      throw new BadRequestException({
        message: 'Invalid file reference',
        errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
      });
    }
    return absolute;
  }
}
