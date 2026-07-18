import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPT_OPTIMIZATIONS_QUEUE } from '../queue/queue.constants';
import { ReceiptOptimizationService } from './receipt-optimization.service';
import { ReceiptStorageService } from './receipt-storage.service';

describe('ReceiptOptimizationService (8.25)', () => {
  const queueMock = { add: jest.fn().mockResolvedValue({}) };
  const storageMock = {
    read: jest.fn(),
    save: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const txMock = {
    receiptFile: { update: jest.fn().mockResolvedValue({}) },
    transactionDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prismaMock = {
    receipt: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
  };

  let service: ReceiptOptimizationService;

  const makeReceipt = (files: object[], status = 'CONFIRMED') => ({
    id: 'r-1',
    status,
    files,
  });

  const jpegPage = async (width = 2600) =>
    sharp({ create: { width, height: Math.round(width * 1.4), channels: 3, background: '#eee' } })
      .jpeg({ quality: 95 })
      .toBuffer();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptOptimizationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ReceiptStorageService, useValue: storageMock },
        { provide: getQueueToken(RECEIPT_OPTIMIZATIONS_QUEUE), useValue: queueMock },
      ],
    }).compile();
    service = module.get(ReceiptOptimizationService);
  });

  it('enqueue dedups on a stable jobId', async () => {
    await service.enqueue('r-9');
    // Dash-separated — BullMQ rejects colons in custom job ids.
    expect(queueMock.add).toHaveBeenCalledWith(
      'optimize',
      { receiptId: 'r-9' },
      expect.objectContaining({ jobId: 'receipt-optimize-r-9' }),
    );
  });

  it('is a no-op for non-CONFIRMED or vanished receipts', async () => {
    prismaMock.receipt.findUnique.mockResolvedValueOnce(null);
    expect(await service.optimize('gone')).toEqual({ optimized: 0 });

    prismaMock.receipt.findUnique.mockResolvedValueOnce(
      makeReceipt([{ id: 'f-1', position: 1, fileRef: 'x', mimeType: 'image/jpeg' }], 'REVIEW'),
    );
    expect(await service.optimize('r-1')).toEqual({ optimized: 0 });
    expect(storageMock.read).not.toHaveBeenCalled();
  });

  it('re-encodes jpeg pages and moves receipt_files + transaction_documents together', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(
      makeReceipt([
        { id: 'f-1', position: 1, fileRef: '2026/07/a.jpg', mimeType: 'image/jpeg' },
        { id: 'f-2', position: 2, fileRef: '2026/07/b.pdf', mimeType: 'application/pdf' },
      ]),
    );
    storageMock.read.mockResolvedValue(await jpegPage());
    storageMock.save.mockResolvedValue({
      fileRef: '2026/07/new.webp',
      mimeType: 'image/webp',
      sizeBytes: 111,
    });

    const out = await service.optimize('r-1');

    expect(out).toEqual({ optimized: 1 });
    // PDF page untouched.
    expect(storageMock.read).toHaveBeenCalledTimes(1);
    expect(txMock.receiptFile.update).toHaveBeenCalledWith({
      where: { id: 'f-1' },
      data: { fileRef: '2026/07/new.webp', mimeType: 'image/webp', sizeBytes: 111 },
    });
    expect(txMock.transactionDocument.updateMany).toHaveBeenCalledWith({
      where: { fileRef: '2026/07/a.jpg' },
      data: { fileRef: '2026/07/new.webp', mimeType: 'image/webp', sizeBytes: 111 },
    });
    expect(storageMock.delete).toHaveBeenCalledWith('2026/07/a.jpg');
  });

  it('keeps the original when WebP is not smaller (keep-original guard)', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(
      makeReceipt([
        { id: 'f-1', position: 1, fileRef: '2026/07/tiny.jpg', mimeType: 'image/jpeg' },
      ]),
    );
    // Random noise crushed to a low-quality JPEG: preserving its artifacts
    // at WebP q80 costs ~3× the bytes, so the guard reliably trips.
    const raw = Buffer.alloc(200 * 200 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
    storageMock.read.mockResolvedValue(
      await sharp(raw, { raw: { width: 200, height: 200, channels: 3 } })
        .jpeg({ quality: 15 })
        .toBuffer(),
    );

    const out = await service.optimize('r-1');

    expect(out).toEqual({ optimized: 0 });
    expect(storageMock.save).not.toHaveBeenCalled();
    expect(txMock.receiptFile.update).not.toHaveBeenCalled();
    expect(storageMock.delete).not.toHaveBeenCalled();
  });
});
