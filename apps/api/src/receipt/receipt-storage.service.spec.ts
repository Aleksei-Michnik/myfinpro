import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReceiptStorageService } from './receipt-storage.service';

// Minimal valid magic-byte fixtures (content past the header is irrelevant
// to the sniffer).
const FIXTURES = {
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]),
  png: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16, 1)]),
  webp: Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x10, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.alloc(8, 1),
  ]),
  heic: Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypheic'),
    Buffer.alloc(8, 1),
  ]),
  pdf: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(16, 1)]),
  gif: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16, 1)]),
};

describe('ReceiptStorageService', () => {
  let dir: string;
  let service: ReceiptStorageService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'receipt-storage-'));
    const config = {
      get: (key: string, def?: string) => (key === 'RECEIPT_STORAGE_DIR' ? dir : def),
    };
    service = new ReceiptStorageService(config as unknown as ConfigService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('detectMimeType', () => {
    it.each([
      ['jpeg', 'image/jpeg'],
      ['png', 'image/png'],
      ['webp', 'image/webp'],
      ['heic', 'image/heic'],
      ['pdf', 'application/pdf'],
    ] as const)('detects %s from magic bytes', (key, expected) => {
      expect(ReceiptStorageService.detectMimeType(FIXTURES[key])).toBe(expected);
    });

    it('returns null for non-whitelisted content (gif, text, tiny buffers)', () => {
      expect(ReceiptStorageService.detectMimeType(FIXTURES.gif)).toBeNull();
      expect(
        ReceiptStorageService.detectMimeType(Buffer.from('hello world, not a file')),
      ).toBeNull();
      expect(ReceiptStorageService.detectMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
    });
  });

  describe('save', () => {
    it('persists under yyyy/mm with a detected-type extension and returns the ref', async () => {
      const saved = await service.save(FIXTURES.jpeg);
      expect(saved.mimeType).toBe('image/jpeg');
      expect(saved.sizeBytes).toBe(FIXTURES.jpeg.length);
      expect(saved.fileRef).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
      const onDisk = await readFile(path.join(dir, saved.fileRef));
      expect(onDisk.equals(FIXTURES.jpeg)).toBe(true);
    });

    it('rejects non-whitelisted content with RECEIPT_INVALID_FILE_TYPE', async () => {
      await expect(service.save(FIXTURES.gif)).rejects.toThrow(BadRequestException);
      await expect(service.save(Buffer.alloc(0))).rejects.toThrow(BadRequestException);
    });

    it('rejects files over the 10MB cap with RECEIPT_FILE_TOO_LARGE', async () => {
      const big = Buffer.concat([FIXTURES.pdf, Buffer.alloc(10 * 1024 * 1024)]);
      try {
        await service.save(big);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as BadRequestException).getResponse() as { errorCode?: string }).toMatchObject({
          errorCode: 'RECEIPT_FILE_TOO_LARGE',
        });
      }
    });
  });

  describe('openStream / delete / resolveFileRef', () => {
    it('streams a stored file back with its size', async () => {
      const saved = await service.save(FIXTURES.pdf);
      const { stream, sizeBytes } = await service.openStream(saved.fileRef);
      expect(sizeBytes).toBe(FIXTURES.pdf.length);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).equals(FIXTURES.pdf)).toBe(true);
    });

    it('404s for a missing file', async () => {
      await expect(service.openStream('2026/07/nope.pdf')).rejects.toThrow(NotFoundException);
    });

    it('delete is best-effort and idempotent', async () => {
      const saved = await service.save(FIXTURES.png);
      await service.delete(saved.fileRef);
      await expect(stat(path.join(dir, saved.fileRef))).rejects.toThrow();
      // Second delete of the same ref must not throw.
      await expect(service.delete(saved.fileRef)).resolves.toBeUndefined();
    });

    it('rejects path traversal outside the storage root', () => {
      expect(() => service.resolveFileRef('../../etc/passwd')).toThrow(BadRequestException);
      expect(() => service.resolveFileRef('2026/07/../../../escape.pdf')).toThrow(
        BadRequestException,
      );
      // Legit nested ref resolves inside the root.
      expect(service.resolveFileRef('2026/07/x.pdf').startsWith(dir)).toBe(true);
    });
  });
});
