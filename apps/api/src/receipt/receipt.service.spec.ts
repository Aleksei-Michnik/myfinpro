import { encodeCursor } from '@myfinpro/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPT_EXTRACTIONS_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { ReceiptStorageService } from './receipt-storage.service';
import { ReceiptService } from './receipt.service';

const codeOf = (err: unknown): string | undefined =>
  ((err as { getResponse?: () => { errorCode?: string } }).getResponse?.() ?? {}).errorCode;

describe('ReceiptService', () => {
  const prismaMock = {
    receipt: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const storageMock = {
    save: jest.fn(),
    openStream: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const eventBusMock = { publish: jest.fn() };
  const queueMock = { add: jest.fn().mockResolvedValue({}) };

  let service: ReceiptService;

  const makeRow = (over: Record<string, unknown> = {}) => ({
    id: 'r-1',
    status: 'UPLOADED',
    source: 'upload',
    fileRef: '2026/07/abc.jpg',
    originalName: 'receipt.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    sourceUrl: null,
    merchantId: null,
    merchant: null,
    extractedMerchantName: null,
    purchasedAt: null,
    currency: null,
    totalCents: null,
    discountCents: null,
    rawExtraction: null,
    failureReason: null,
    uploadedById: 'u-1',
    paymentId: null,
    createdAt: new Date('2026-07-04T10:00:00.000Z'),
    updatedAt: new Date('2026-07-04T10:00:00.000Z'),
    items: [],
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ReceiptStorageService, useValue: storageMock },
        { provide: EventBus, useValue: eventBusMock },
        { provide: getQueueToken(RECEIPT_EXTRACTIONS_QUEUE), useValue: queueMock },
      ],
    }).compile();
    service = module.get(ReceiptService);
  });

  describe('createFromUpload', () => {
    it('stores the file, creates the row, enqueues extraction, audits, publishes', async () => {
      storageMock.save.mockResolvedValue({
        fileRef: '2026/07/abc.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
      });
      prismaMock.receipt.create.mockResolvedValue(makeRow());

      const dto = await service.createFromUpload('u-1', Buffer.from('x'), 'receipt.jpg');

      expect(storageMock.save).toHaveBeenCalled();
      const createArg = prismaMock.receipt.create.mock.calls[0][0].data;
      expect(createArg).toEqual(
        expect.objectContaining({
          status: 'UPLOADED',
          source: 'upload',
          fileRef: '2026/07/abc.jpg',
          mimeType: 'image/jpeg',
          uploadedById: 'u-1',
        }),
      );
      // Job: named 'extract', receipt payload, 3 attempts + backoff.
      const [jobName, jobData, jobOpts] = queueMock.add.mock.calls[0];
      expect(jobName).toBe('extract');
      expect(jobData).toEqual({ receiptId: 'r-1' });
      expect(jobOpts).toEqual(
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        }),
      );
      expect(jobOpts.jobId).toMatch(/^receipt:r-1:/);
      expect(eventBusMock.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'receipt.updated', userIds: ['u-1'] }),
      );
      expect(dto.status).toBe('UPLOADED');
      expect(dto.itemsSumCents).toBe(0);
    });

    it('a storage rejection propagates and nothing is persisted or enqueued', async () => {
      storageMock.save.mockRejectedValue(new BadRequestException());
      await expect(service.createFromUpload('u-1', Buffer.from('x'), null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.receipt.create).not.toHaveBeenCalled();
      expect(queueMock.add).not.toHaveBeenCalled();
    });
  });

  describe('createFromUrl', () => {
    it('creates a url-source row without touching storage', async () => {
      prismaMock.receipt.create.mockResolvedValue(
        makeRow({ source: 'url', fileRef: null, sourceUrl: 'https://r.example/x' }),
      );
      const dto = await service.createFromUrl('u-1', { url: 'https://r.example/x' });
      expect(storageMock.save).not.toHaveBeenCalled();
      expect(dto.source).toBe('url');
      expect(dto.sourceUrl).toBe('https://r.example/x');
      expect(queueMock.add).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('paginates newest-first with an opaque cursor', async () => {
      const rows = [
        makeRow({ id: 'r-3', createdAt: new Date('2026-07-04T12:00:00.000Z') }),
        makeRow({ id: 'r-2', createdAt: new Date('2026-07-04T11:00:00.000Z') }),
        makeRow({ id: 'r-1', createdAt: new Date('2026-07-04T10:00:00.000Z') }),
      ];
      prismaMock.receipt.findMany.mockResolvedValue(rows);

      const page = await service.list('u-1', { limit: 2 });

      expect(page.hasMore).toBe(true);
      expect(page.data.map((r) => r.id)).toEqual(['r-3', 'r-2']);
      expect(page.nextCursor).toEqual(expect.any(String));
      // Second call decodes the cursor into a keyset filter.
      prismaMock.receipt.findMany.mockResolvedValue([rows[2]]);
      await service.list('u-1', { limit: 2, cursor: page.nextCursor! });
      const where = prismaMock.receipt.findMany.mock.calls[1][0].where;
      expect(where.OR).toBeDefined();
      expect(where.uploadedById).toBe('u-1');
    });

    it('applies the status filter and rejects malformed cursors', async () => {
      prismaMock.receipt.findMany.mockResolvedValue([]);
      await service.list('u-1', { status: 'REVIEW' });
      expect(prismaMock.receipt.findMany.mock.calls[0][0].where.status).toBe('REVIEW');

      await expect(service.list('u-1', { cursor: '!!not-base64-json!!' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.list('u-1', { cursor: encodeCursor({ createdAt: 'bogus', id: '' }) }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOne / openFile', () => {
    it("404s for another user's receipt without existence leak", async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(null);
      try {
        await service.getOne('intruder', 'r-1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('RECEIPT_NOT_FOUND');
      }
      expect(prismaMock.receipt.findFirst.mock.calls[0][0].where).toEqual({
        id: 'r-1',
        uploadedById: 'intruder',
      });
    });

    it('streams the stored file with its mime type', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow());
      storageMock.openStream.mockResolvedValue({ stream: 'STREAM', sizeBytes: 1234 });
      const out = await service.openFile('u-1', 'r-1');
      expect(storageMock.openStream).toHaveBeenCalledWith('2026/07/abc.jpg');
      expect(out.mimeType).toBe('image/jpeg');
      expect(out.sizeBytes).toBe(1234);
    });

    it('404s when a url-source receipt has no stored file yet', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ fileRef: null }));
      await expect(service.openFile('u-1', 'r-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('retry', () => {
    it('re-enqueues a FAILED receipt and clears the failure reason', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(
        makeRow({ status: 'FAILED', failureReason: 'provider exploded' }),
      );
      prismaMock.receipt.update.mockResolvedValue(makeRow({ status: 'UPLOADED' }));

      const dto = await service.retry('u-1', 'r-1');

      expect(prismaMock.receipt.update.mock.calls[0][0].data).toEqual({
        status: 'UPLOADED',
        failureReason: null,
      });
      expect(queueMock.add).toHaveBeenCalled();
      expect(dto.status).toBe('UPLOADED');
    });

    it('rejects retry from any non-FAILED state', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'REVIEW' }));
      try {
        await service.retry('u-1', 'r-1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('RECEIPT_INVALID_STATE');
      }
      expect(queueMock.add).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes row + file and publishes receipt.deleted', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'REVIEW' }));
      prismaMock.receipt.delete.mockResolvedValue({});
      await service.remove('u-1', 'r-1');
      expect(prismaMock.receipt.delete).toHaveBeenCalledWith({ where: { id: 'r-1' } });
      expect(storageMock.delete).toHaveBeenCalledWith('2026/07/abc.jpg');
      expect(eventBusMock.publish).toHaveBeenCalledWith({
        type: 'receipt.deleted',
        userIds: ['u-1'],
        receiptId: 'r-1',
      });
    });

    it('blocks deleting CONFIRMED receipts', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'CONFIRMED' }));
      try {
        await service.remove('u-1', 'r-1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('RECEIPT_ALREADY_CONFIRMED');
      }
      expect(prismaMock.receipt.delete).not.toHaveBeenCalled();
    });
  });

  it('a realtime publish failure never breaks the operation', async () => {
    storageMock.save.mockResolvedValue({
      fileRef: '2026/07/abc.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1,
    });
    prismaMock.receipt.create.mockResolvedValue(makeRow());
    eventBusMock.publish.mockImplementation(() => {
      throw new Error('redis blip');
    });
    await expect(service.createFromUpload('u-1', Buffer.from('x'), null)).resolves.toMatchObject({
      id: 'r-1',
    });
  });
});
