import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  RECEIPT_ALLOWED_MIME_TYPES,
  RECEIPT_MAX_FILE_SIZE_BYTES,
  type ReceiptMimeType,
} from '@myfinpro/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RECEIPT_ERRORS } from './constants/receipt-errors';

/**
 * Phase 7, iteration 7.3 — receipt file storage.
 *
 * Files live OUTSIDE the web root under `RECEIPT_STORAGE_DIR` (default
 * `<cwd>/storage/receipts`), laid out as `<yyyy>/<mm>/<uuid>.<ext>` and
 * served exclusively through the authenticated download endpoint (7.4).
 *
 * The MIME type is detected from MAGIC BYTES — the client-declared
 * content type and filename are advisory only (design §5). The extension
 * on disk derives from the detected type, never from user input, so the
 * storage layer is immune to `../` names and double extensions by
 * construction; `resolveFileRef` additionally guards path traversal on
 * the read side.
 */
@Injectable()
export class ReceiptStorageService {
  private readonly logger = new Logger(ReceiptStorageService.name);
  private readonly root: string;

  constructor(configService: ConfigService) {
    this.root = path.resolve(
      configService.get<string>('RECEIPT_STORAGE_DIR', '') ||
        path.join(process.cwd(), 'storage', 'receipts'),
    );
  }

  /** Detected-MIME → canonical on-disk extension. */
  private static readonly EXTENSIONS: Record<ReceiptMimeType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  };

  /**
   * Sniff the whitelisted receipt types from magic bytes. Returns null for
   * anything else — dependency-free on purpose; five stable signatures do
   * not justify a package.
   */
  static detectMimeType(buffer: Buffer): ReceiptMimeType | null {
    if (buffer.length < 12) return null;
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
    // WebP: "RIFF" .... "WEBP"
    if (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    // HEIC/HEIF: ISO-BMFF "ftyp" at offset 4 with a heic-family brand.
    if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
      const brand = buffer.subarray(8, 12).toString('ascii');
      if (
        ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)
      ) {
        return 'image/heic';
      }
    }
    // PDF: "%PDF"
    if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
    return null;
  }

  /**
   * Validate + persist an uploaded buffer. Throws structured 400s for
   * oversize and non-whitelisted content. Returns the relative `fileRef`
   * stored on the receipt row.
   */
  async save(
    buffer: Buffer,
  ): Promise<{ fileRef: string; mimeType: ReceiptMimeType; sizeBytes: number }> {
    if (buffer.length === 0) {
      throw new BadRequestException({
        message: 'Empty file',
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_FILE_TYPE,
      });
    }
    if (buffer.length > RECEIPT_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        message: `File exceeds the ${RECEIPT_MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`,
        errorCode: RECEIPT_ERRORS.RECEIPT_FILE_TOO_LARGE,
      });
    }
    const mimeType = ReceiptStorageService.detectMimeType(buffer);
    if (!mimeType || !(RECEIPT_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new BadRequestException({
        message: `Unsupported file type; allowed: ${RECEIPT_ALLOWED_MIME_TYPES.join(', ')}`,
        errorCode: RECEIPT_ERRORS.RECEIPT_INVALID_FILE_TYPE,
      });
    }

    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const fileRef = path.posix.join(
      yyyy,
      mm,
      `${randomUUID()}.${ReceiptStorageService.EXTENSIONS[mimeType]}`,
    );

    const absolute = this.resolveFileRef(fileRef);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);
    this.logger.log(`Stored receipt file ${fileRef} (${mimeType}, ${buffer.length} bytes)`);
    return { fileRef, mimeType, sizeBytes: buffer.length };
  }

  /** Open a read stream for the download endpoint. 404s when missing. */
  async openStream(fileRef: string): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number }> {
    const absolute = this.resolveFileRef(fileRef);
    try {
      const info = await stat(absolute);
      return { stream: createReadStream(absolute), sizeBytes: info.size };
    } catch {
      throw new NotFoundException({
        message: 'Receipt file not found',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
  }

  /**
   * Best-effort delete — the DB row is the source of truth; a failed
   * unlink is logged, never thrown (matches the design §5 contract).
   */
  async delete(fileRef: string): Promise<void> {
    try {
      await rm(this.resolveFileRef(fileRef));
    } catch (err) {
      this.logger.warn(`Failed to delete receipt file ${fileRef}: ${(err as Error).message}`);
    }
  }

  /**
   * Resolve a stored fileRef to an absolute path, rejecting anything that
   * escapes the storage root (defence in depth — refs are server-minted,
   * but rows could be tampered with at other layers).
   */
  resolveFileRef(fileRef: string): string {
    const absolute = path.resolve(this.root, fileRef);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) {
      throw new BadRequestException({
        message: 'Invalid file reference',
        errorCode: RECEIPT_ERRORS.RECEIPT_NOT_FOUND,
      });
    }
    return absolute;
  }
}
