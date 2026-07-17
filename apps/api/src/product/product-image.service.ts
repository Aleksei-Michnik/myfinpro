import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCT_IMAGE_MAX_COUNT, PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, ProductImage } from '@prisma/client';
import type { Queue } from 'bullmq';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_IMAGES_QUEUE } from '../queue/queue.constants';
import { ReceiptStorageService } from '../receipt/receipt-storage.service';
import { PRODUCT_ERRORS } from './constants/product-errors';

/** Rendition geometry/quality (design §3.2) — recognition aids, not documents. */
const DETAIL_MAX_EDGE = 512;
const DETAIL_WEBP_QUALITY = 82;
const DETAIL_AVIF_QUALITY = 50;
const THUMB_MAX_EDGE = 96;
const THUMB_WEBP_QUALITY = 75;
const THUMB_AVIF_QUALITY = 45;

/** Cap for OFF prefill downloads (their front images are ~50–200KB). */
const URL_FETCH_MAX_BYTES = 5 * 1024 * 1024;
const URL_FETCH_TIMEOUT_MS = 15_000;

/** Stagger for the bootstrap rendition-backfill sweep (design §3.4). */
const BACKFILL_STAGGER_MS = 2_000;

export type ProductImageJob =
  /** New upload, staged raw on disk. */
  | { productImageId: string; kind: 'staged'; stagedRef: string }
  /** OFF prefill — the worker downloads the source. */
  | { productImageId: string; kind: 'url'; url: string }
  /** Rendition backfill — re-derive missing files from `<base>.webp`. */
  | { productImageId: string; kind: 'regen' };

export type ProductImageSize = 'full' | 'thumb';

/** The four rendition files derived from one baseRef (design §3.2). */
export function renditionRefs(baseRef: string): {
  webp: string;
  avif: string;
  thumbWebp: string;
  thumbAvif: string;
} {
  return {
    webp: `${baseRef}.webp`,
    avif: `${baseRef}.avif`,
    thumbWebp: `${baseRef}.thumb.webp`,
    thumbAvif: `${baseRef}.thumb.avif`,
  };
}

/**
 * Phase 8.25 (supersedes 8.8's single image) — up to
 * {@link PRODUCT_IMAGE_MAX_COUNT} pictures per product. Rows are created
 * up front with a server-minted immutable `baseRef`; the BullMQ worker
 * re-encodes the source into four renditions (WebP + AVIF × detail +
 * thumb) at that stem. sharp auto-rotates (EXIF orientation) and
 * re-encoding strips EXIF/GPS by construction. AVIF is best-effort: an
 * encoder failure logs and leaves the WebP pair authoritative. Files live
 * outside the web root under PRODUCT_IMAGE_STORAGE_DIR (default
 * `<cwd>/storage/products`), same layout + traversal guard as receipts.
 */
@Injectable()
export class ProductImageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductImageService.name);
  private readonly root: string;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue(PRODUCT_IMAGES_QUEUE) private readonly queue: Queue<ProductImageJob>,
  ) {
    this.root = path.resolve(
      configService.get<string>('PRODUCT_IMAGE_STORAGE_DIR', '') ||
        path.join(process.cwd(), 'storage', 'products'),
    );
  }

  /**
   * Self-healing rendition backfill (design §3.4): rows migrated from the
   * single-image era have only `<base>.webp` on disk. One scan job per
   * boot (deduped by jobId) fans out per-row regen jobs, staggered.
   */
  onApplicationBootstrap(): void {
    void this.enqueueRenditionBackfill().catch((err: Error) =>
      this.logger.warn(`Rendition backfill enqueue failed: ${err.message}`),
    );
  }

  /** Validate + stage an uploaded buffer, create the row, enqueue the encode. */
  async addFromUpload(productId: string, buffer: Buffer): Promise<ProductImage> {
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

    const row = await this.createRow(productId);
    await this.enqueue({ productImageId: row.id, kind: 'staged', stagedRef });
    return row;
  }

  /** OFF prefill image — row now, download + encode in the worker. */
  async addFromUrl(productId: string, url: string): Promise<void> {
    if (!url.startsWith('https://')) return; // prefill URLs are https-only
    const row = await this.createRow(productId);
    await this.enqueue({ productImageId: row.id, kind: 'url', url });
  }

  /** Delete a picture: row + renditions; survivors renumber contiguously. */
  async remove(productId: string, imageId: string): Promise<ProductImage> {
    const row = await this.prisma.$transaction(async (tx) => {
      const found = await tx.productImage.findFirst({
        where: { id: imageId, productId },
      });
      if (!found) {
        throw new NotFoundException({
          message: 'Product image not found',
          errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
        });
      }
      await tx.productImage.delete({ where: { id: found.id } });
      await this.renumber(tx, productId);
      return found;
    });
    await this.deleteRenditions(row.baseRef);
    return row;
  }

  /**
   * Move a picture to `position` (1-based); the rest renumber contiguously
   * around it. Position 1 defines the primary image (design §3.3).
   */
  async reorder(productId: string, imageId: string, position: number): Promise<ProductImage[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.productImage.findMany({
        where: { productId },
        orderBy: { position: 'asc' },
      });
      const index = rows.findIndex((r) => r.id === imageId);
      if (index === -1) {
        throw new NotFoundException({
          message: 'Product image not found',
          errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
        });
      }
      const target = Math.min(Math.max(position, 1), rows.length);
      const [moved] = rows.splice(index, 1);
      rows.splice(target - 1, 0, moved);
      // Two-pass renumber — (productId, position) is unique, so pass one
      // parks every row out of range before pass two assigns 1..n.
      for (let i = 0; i < rows.length; i++) {
        await tx.productImage.update({
          where: { id: rows[i].id },
          data: { position: i + 1 + rows.length },
        });
      }
      for (let i = 0; i < rows.length; i++) {
        await tx.productImage.update({ where: { id: rows[i].id }, data: { position: i + 1 } });
      }
      return tx.productImage.findMany({ where: { productId }, orderBy: { position: 'asc' } });
    });
  }

  /**
   * Worker entry: load the source bytes and write the renditions at the
   * row's baseRef. Rows are immutable, so a completed job needs no DB
   * update — the files simply appear.
   */
  async process(job: ProductImageJob, baseRef: string): Promise<void> {
    let source: Buffer;
    if (job.kind === 'staged') {
      source = await readFile(this.resolveRef(job.stagedRef));
    } else if (job.kind === 'url') {
      const res = await fetch(job.url, {
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'myfinpro/1.0 (product image prefill)' },
      });
      if (!res.ok) throw new Error(`Image URL returned ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length > URL_FETCH_MAX_BYTES) throw new Error('Image URL response too large');
      source = raw;
    } else {
      // regen: re-derive the missing renditions from the stored detail WebP.
      source = await readFile(this.resolveRef(renditionRefs(baseRef).webp));
    }

    const refs = renditionRefs(baseRef);
    const absolute = this.resolveRef(refs.webp);
    await mkdir(path.dirname(absolute), { recursive: true });

    // rotate() applies EXIF orientation; re-encoding drops all metadata
    // (EXIF/GPS). The detail WebP is written first — it is the one
    // rendition serving falls back on and regen derives from.
    const detail = sharp(source)
      .rotate()
      .resize(DETAIL_MAX_EDGE, DETAIL_MAX_EDGE, { fit: 'inside', withoutEnlargement: true });
    const thumb = sharp(source)
      .rotate()
      .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: 'inside', withoutEnlargement: true });

    if (job.kind !== 'regen') {
      await writeFile(
        absolute,
        await detail.clone().webp({ quality: DETAIL_WEBP_QUALITY }).toBuffer(),
      );
    }
    await writeFile(
      this.resolveRef(refs.thumbWebp),
      await thumb.clone().webp({ quality: THUMB_WEBP_QUALITY }).toBuffer(),
    );
    // AVIF is best-effort (design §3.2): failure degrades serving to WebP.
    try {
      await writeFile(
        this.resolveRef(refs.avif),
        await detail.clone().avif({ quality: DETAIL_AVIF_QUALITY }).toBuffer(),
      );
      await writeFile(
        this.resolveRef(refs.thumbAvif),
        await thumb.clone().avif({ quality: THUMB_AVIF_QUALITY }).toBuffer(),
      );
    } catch (err) {
      this.logger.warn(`AVIF encode failed for ${baseRef}: ${(err as Error).message}`);
    }
    this.logger.log(`Processed product image ${baseRef} (${job.kind}, ${source.length} bytes in)`);
  }

  /**
   * Open a rendition for serving with `Accept` negotiation (design §3.3):
   * AVIF when the client accepts it and the file exists, else WebP.
   */
  async openRendition(
    baseRef: string,
    size: ProductImageSize,
    acceptsAvif: boolean,
  ): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number; contentType: string }> {
    const refs = renditionRefs(baseRef);
    const candidates: { ref: string; contentType: string }[] = [];
    if (acceptsAvif) {
      candidates.push({
        ref: size === 'thumb' ? refs.thumbAvif : refs.avif,
        contentType: 'image/avif',
      });
    }
    // Thumb WebP may be missing on freshly backfilled rows — the detail
    // WebP is the rendition guaranteed to exist, so it is the last resort.
    if (size === 'thumb') candidates.push({ ref: refs.thumbWebp, contentType: 'image/webp' });
    candidates.push({ ref: refs.webp, contentType: 'image/webp' });

    for (const candidate of candidates) {
      const absolute = this.resolveRef(candidate.ref);
      try {
        const info = await stat(absolute);
        return {
          stream: createReadStream(absolute),
          sizeBytes: info.size,
          contentType: candidate.contentType,
        };
      } catch {
        // try the next fallback
      }
    }
    throw new NotFoundException({
      message: 'Product image not found',
      errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
    });
  }

  /** Best-effort delete of a staged original. */
  async delete(ref: string): Promise<void> {
    try {
      await rm(this.resolveRef(ref));
    } catch (err) {
      this.logger.warn(`Failed to delete product image ${ref}: ${(err as Error).message}`);
    }
  }

  /** Best-effort delete of all four renditions of a removed row. */
  async deleteRenditions(baseRef: string): Promise<void> {
    const refs = renditionRefs(baseRef);
    await Promise.all(Object.values(refs).map((ref) => this.delete(ref)));
  }

  /** Cap-checked row creation at the next position, baseRef minted here. */
  private async createRow(productId: string): Promise<ProductImage> {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const baseRef = path.posix.join(yyyy, mm, randomUUID());

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.productImage.count({ where: { productId } });
      if (count >= PRODUCT_IMAGE_MAX_COUNT) {
        throw new BadRequestException({
          message: `A product holds at most ${PRODUCT_IMAGE_MAX_COUNT} pictures`,
          errorCode: PRODUCT_ERRORS.PRODUCT_IMAGE_LIMIT_REACHED,
        });
      }
      return tx.productImage.create({
        data: { productId, position: count + 1, baseRef },
      });
    });
  }

  /** Close the position gap after a delete (1..n, order preserved). */
  private async renumber(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    const rows = await tx.productImage.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    // Same two-pass dance as reorder — the unique index forbids collisions.
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].position !== i + 1) {
        await tx.productImage.update({
          where: { id: rows[i].id },
          data: { position: i + 1 + rows.length },
        });
      }
    }
    for (let i = 0; i < rows.length; i++) {
      const parked = await tx.productImage.findUnique({
        where: { id: rows[i].id },
        select: { position: true },
      });
      if (parked && parked.position !== i + 1) {
        await tx.productImage.update({ where: { id: rows[i].id }, data: { position: i + 1 } });
      }
    }
  }

  private async enqueueRenditionBackfill(): Promise<void> {
    const rows = await this.prisma.productImage.findMany({
      select: { id: true, baseRef: true },
      orderBy: { createdAt: 'asc' },
    });
    let enqueued = 0;
    for (const row of rows) {
      try {
        await stat(this.resolveRef(renditionRefs(row.baseRef).thumbWebp));
      } catch {
        await this.queue.add(
          'process',
          { productImageId: row.id, kind: 'regen' },
          {
            // Stable jobId — a re-boot while jobs are queued is a no-op.
            jobId: `product-image-regen:${row.id}`,
            delay: enqueued * BACKFILL_STAGGER_MS,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
        enqueued++;
      }
    }
    if (enqueued > 0) this.logger.log(`Rendition backfill: ${enqueued} product image(s) enqueued`);
  }

  private async enqueue(job: ProductImageJob): Promise<void> {
    await this.queue.add('process', job, {
      jobId: `product-image:${job.productImageId}:${Date.now()}`,
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
