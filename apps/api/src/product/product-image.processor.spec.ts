import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ProductImageProcessor } from './product-image.processor';
import { ProductImageService, type ProductImageJob } from './product-image.service';

describe('ProductImageProcessor', () => {
  const imagesMock = {
    process: jest.fn(),
    delete: jest.fn(),
    removeDeadRow: jest.fn(),
  };
  const prismaMock = { productImage: { findUnique: jest.fn() } };
  let processor: ProductImageProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductImageProcessor,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProductImageService, useValue: imagesMock },
      ],
    }).compile();
    processor = module.get(ProductImageProcessor);
  });

  const makeJob = (data: ProductImageJob, attemptsMade: number, attempts = 3) =>
    ({ data, attemptsMade, opts: { attempts } }) as unknown as Job<ProductImageJob>;

  const stagedJob = (attemptsMade: number) =>
    makeJob({ productImageId: 'img-1', kind: 'staged', stagedRef: 'incoming/s' }, attemptsMade);

  it('succeeds: cleans the staged original, keeps the row', async () => {
    prismaMock.productImage.findUnique.mockResolvedValue({ id: 'img-1', baseRef: 'x/y' });
    imagesMock.process.mockResolvedValue(undefined);
    await expect(processor.process(stagedJob(0))).resolves.toEqual({ processed: true });
    expect(imagesMock.delete).toHaveBeenCalledWith('incoming/s');
    expect(imagesMock.removeDeadRow).not.toHaveBeenCalled();
  });

  it('keeps the row and the staged original while retries remain', async () => {
    prismaMock.productImage.findUnique.mockResolvedValue({ id: 'img-1', baseRef: 'x/y' });
    imagesMock.process.mockRejectedValue(new Error('boom'));
    await expect(processor.process(stagedJob(0))).rejects.toThrow('boom');
    expect(imagesMock.delete).not.toHaveBeenCalled();
    expect(imagesMock.removeDeadRow).not.toHaveBeenCalled();
  });

  it('drops the row when the final attempt fails — frees the slot for a re-upload', async () => {
    prismaMock.productImage.findUnique.mockResolvedValue({ id: 'img-1', baseRef: 'x/y' });
    imagesMock.process.mockRejectedValue(new Error('VipsJpeg: Invalid SOS parameters'));
    await expect(processor.process(stagedJob(2))).rejects.toThrow('VipsJpeg');
    expect(imagesMock.delete).toHaveBeenCalledWith('incoming/s');
    expect(imagesMock.removeDeadRow).toHaveBeenCalledWith('img-1');
  });

  it('never drops a regen row — its detail WebP keeps serving', async () => {
    prismaMock.productImage.findUnique.mockResolvedValue({ id: 'img-2', baseRef: 'x/z' });
    imagesMock.process.mockRejectedValue(new Error('ENOENT'));
    await expect(
      processor.process(makeJob({ productImageId: 'img-2', kind: 'regen' }, 2)),
    ).rejects.toThrow('ENOENT');
    expect(imagesMock.removeDeadRow).not.toHaveBeenCalled();
  });

  it('orphan row: no-op that discards the staged file', async () => {
    prismaMock.productImage.findUnique.mockResolvedValue(null);
    await expect(processor.process(stagedJob(0))).resolves.toEqual({ processed: false });
    expect(imagesMock.delete).toHaveBeenCalledWith('incoming/s');
    expect(imagesMock.removeDeadRow).not.toHaveBeenCalled();
  });
});
