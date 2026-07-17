import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PRODUCT_IMAGE_MAX_COUNT } from '@myfinpro/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_IMAGES_QUEUE } from '../queue/queue.constants';
import { ProductImageService, renditionRefs } from './product-image.service';

const codeOf = (err: unknown): string | undefined =>
  ((err as { getResponse?: () => { errorCode?: string } }).getResponse?.() ?? {}).errorCode;

describe('renditionRefs', () => {
  it('derives the four rendition files from one baseRef', () => {
    expect(renditionRefs('2026/07/abc')).toEqual({
      webp: '2026/07/abc.webp',
      avif: '2026/07/abc.avif',
      thumbWebp: '2026/07/abc.thumb.webp',
      thumbAvif: '2026/07/abc.thumb.avif',
    });
  });
});

describe('ProductImageService (8.25)', () => {
  let root: string;
  let service: ProductImageService;

  const queueMock = { add: jest.fn().mockResolvedValue({}) };
  const txMock = {
    productImage: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  };
  const prismaMock = {
    productImage: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    root = await mkdtemp(path.join(tmpdir(), 'product-images-'));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductImageService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback: string) =>
              key === 'PRODUCT_IMAGE_STORAGE_DIR' ? root : fallback,
          },
        },
        { provide: PrismaService, useValue: prismaMock },
        { provide: getQueueToken(PRODUCT_IMAGES_QUEUE), useValue: queueMock },
      ],
    }).compile();
    service = module.get(ProductImageService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const pngBuffer = () =>
    sharp({ create: { width: 600, height: 400, channels: 3, background: '#888' } })
      .png()
      .toBuffer();

  describe('addFromUpload', () => {
    it('rejects the sixth picture with PRODUCT_IMAGE_LIMIT_REACHED', async () => {
      txMock.productImage.count.mockResolvedValue(PRODUCT_IMAGE_MAX_COUNT);
      try {
        await service.addFromUpload('p-1', await pngBuffer());
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('PRODUCT_IMAGE_LIMIT_REACHED');
      }
      expect(queueMock.add).not.toHaveBeenCalled();
    });

    it('creates the row at the next position and enqueues the encode', async () => {
      txMock.productImage.count.mockResolvedValue(2);
      txMock.productImage.create.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ id: 'img-3', ...data }),
      );
      const row = await service.addFromUpload('p-1', await pngBuffer());
      expect(row.position).toBe(3);
      expect(txMock.productImage.create.mock.calls[0][0].data).toMatchObject({
        productId: 'p-1',
        position: 3,
      });
      expect(queueMock.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ productImageId: 'img-3', kind: 'staged' }),
        expect.any(Object),
      );
    });

    it('rejects PDFs and unknown bytes', async () => {
      try {
        await service.addFromUpload('p-1', Buffer.from('%PDF-1.4 ...'));
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('PRODUCT_INVALID_IMAGE');
      }
    });
  });

  describe('process', () => {
    it('writes all four renditions for a staged upload', async () => {
      const staged = path.join(root, 'incoming', 'stage-1');
      await writeFile(path.dirname(staged) + '/.keep', '').catch(() => undefined);
      await sharp({ create: { width: 900, height: 900, channels: 3, background: '#37c' } })
        .png()
        .toFile(staged)
        .catch(async () => {
          // parent dir may not exist yet
          const { mkdir } = await import('node:fs/promises');
          await mkdir(path.dirname(staged), { recursive: true });
          await sharp({ create: { width: 900, height: 900, channels: 3, background: '#37c' } })
            .png()
            .toFile(staged);
        });

      await service.process(
        { productImageId: 'img-1', kind: 'staged', stagedRef: 'incoming/stage-1' },
        '2026/07/base-1',
      );

      const refs = renditionRefs('2026/07/base-1');
      const detail = sharp(await readFile(path.join(root, refs.webp)));
      const thumb = sharp(await readFile(path.join(root, refs.thumbWebp)));
      expect((await detail.metadata()).width).toBeLessThanOrEqual(512);
      expect((await thumb.metadata()).width).toBeLessThanOrEqual(96);
      // AVIF pair is best-effort but sharp ^0.35 encodes it in CI.
      await expect(readFile(path.join(root, refs.avif))).resolves.toBeInstanceOf(Buffer);
      await expect(readFile(path.join(root, refs.thumbAvif))).resolves.toBeInstanceOf(Buffer);
    });

    it('regen derives missing renditions from the stored detail WebP', async () => {
      const refs = renditionRefs('2026/07/base-2');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(root, '2026/07'), { recursive: true });
      await sharp({ create: { width: 512, height: 340, channels: 3, background: '#c73' } })
        .webp()
        .toFile(path.join(root, refs.webp));

      await service.process({ productImageId: 'img-2', kind: 'regen' }, '2026/07/base-2');

      const thumb = sharp(await readFile(path.join(root, refs.thumbWebp)));
      expect((await thumb.metadata()).width).toBeLessThanOrEqual(96);
    });
  });

  describe('openRendition', () => {
    beforeEach(async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(root, '2026/07'), { recursive: true });
    });

    it('serves AVIF when accepted and present', async () => {
      const refs = renditionRefs('2026/07/neg-1');
      await writeFile(path.join(root, refs.webp), 'webp-bytes');
      await writeFile(path.join(root, refs.avif), 'avif-bytes');
      const out = await service.openRendition('2026/07/neg-1', 'full', true);
      expect(out.contentType).toBe('image/avif');
    });

    it('falls back to WebP when AVIF is missing or not accepted', async () => {
      const refs = renditionRefs('2026/07/neg-2');
      await writeFile(path.join(root, refs.webp), 'webp-bytes');
      expect((await service.openRendition('2026/07/neg-2', 'full', true)).contentType).toBe(
        'image/webp',
      );
      await writeFile(path.join(root, refs.avif), 'avif-bytes');
      expect((await service.openRendition('2026/07/neg-2', 'full', false)).contentType).toBe(
        'image/webp',
      );
    });

    it('thumb falls back to the detail WebP on freshly backfilled rows', async () => {
      const refs = renditionRefs('2026/07/neg-3');
      await writeFile(path.join(root, refs.webp), 'webp-bytes');
      const out = await service.openRendition('2026/07/neg-3', 'thumb', false);
      expect(out.contentType).toBe('image/webp');
      expect(out.sizeBytes).toBe(Buffer.byteLength('webp-bytes'));
    });

    it('404s when nothing exists', async () => {
      try {
        await service.openRendition('2026/07/none', 'full', true);
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('PRODUCT_NOT_FOUND');
      }
    });
  });

  describe('reorder', () => {
    it('moves a row to position 1 and renumbers the rest contiguously', async () => {
      const rows = [
        { id: 'a', productId: 'p-1', position: 1, baseRef: 'x/a' },
        { id: 'b', productId: 'p-1', position: 2, baseRef: 'x/b' },
        { id: 'c', productId: 'p-1', position: 3, baseRef: 'x/c' },
      ];
      txMock.productImage.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
      txMock.productImage.update.mockResolvedValue({});

      await service.reorder('p-1', 'c', 1);

      // Second pass assigns final positions: c→1, a→2, b→3.
      const finals = txMock.productImage.update.mock.calls
        .map(([arg]: [{ where: { id: string }; data: { position: number } }]) => arg)
        .filter((arg) => arg.data.position <= rows.length)
        .map((arg) => [arg.where.id, arg.data.position]);
      expect(finals).toEqual([
        ['c', 1],
        ['a', 2],
        ['b', 3],
      ]);
    });
  });
});
