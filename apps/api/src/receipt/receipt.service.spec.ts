import { encodeCursor } from '@myfinpro/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CategoryService } from '../category/category.service';
import { PaymentService } from '../payment/payment.service';
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
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    receiptItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    merchant: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  const categoryMock = { list: jest.fn() };
  const paymentServiceMock = {
    validateExpenseInputs: jest.fn(),
    createExpenseWithinTx: jest.fn(),
    publishCreated: jest.fn().mockResolvedValue({}),
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
        { provide: CategoryService, useValue: categoryMock },
        { provide: PaymentService, useValue: paymentServiceMock },
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

    it('rejects non-public (SSRF) URLs before writing anything', async () => {
      for (const url of [
        'http://169.254.169.254/latest',
        'http://localhost/x',
        'http://10.0.0.5/x',
      ]) {
        try {
          await service.createFromUrl('u-1', { url });
          throw new Error(`should have rejected ${url}`);
        } catch (err) {
          expect(codeOf(err)).toBe('RECEIPT_INVALID_URL');
        }
      }
      expect(prismaMock.receipt.create).not.toHaveBeenCalled();
      expect(queueMock.add).not.toHaveBeenCalled();
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

  describe('update (7.8)', () => {
    it('REVIEW-only: applies header corrections incl. null clears and merchant link', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'REVIEW' }));
      prismaMock.merchant.findUnique.mockResolvedValue({ id: 'm-1', name: 'Shufersal' });
      prismaMock.receipt.update.mockResolvedValue(
        makeRow({ status: 'REVIEW', extractedMerchantName: 'Shufersal' }),
      );

      await service.update('u-1', 'r-1', {
        extractedMerchantName: '  Shufersal  ',
        merchantId: 'm-1',
        purchasedAt: null,
        totalCents: 4590,
      });

      const data = prismaMock.receipt.update.mock.calls[0][0].data;
      expect(data.extractedMerchantName).toBe('Shufersal');
      expect(data.merchant).toEqual({ connect: { id: 'm-1' } });
      expect(data.purchasedAt).toBeNull();
      expect(data.totalCents).toBe(4590);
      expect(data.currency).toBeUndefined(); // untouched field stays out
      expect(eventBusMock.publish).toHaveBeenCalled();
    });

    it('rejects edits outside REVIEW and unknown merchants', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'EXTRACTING' }));
      try {
        await service.update('u-1', 'r-1', { totalCents: 1 });
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('RECEIPT_INVALID_STATE');
      }

      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'REVIEW' }));
      prismaMock.merchant.findUnique.mockResolvedValue(null);
      try {
        await service.update('u-1', 'r-1', { merchantId: '3b2c9a3e-0000-0000-0000-000000000000' });
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('MERCHANT_NOT_FOUND');
      }
    });
  });

  describe('replaceItems (7.8)', () => {
    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ receiptItem: prismaMock.receiptItem }),
      );
      prismaMock.receipt.findUnique.mockResolvedValue(makeRow({ status: 'REVIEW' }));
    });

    it('replaces items with 1-based positions after category validation', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'REVIEW' }));
      categoryMock.list.mockResolvedValue([{ id: 'cat-1', name: 'Groceries' }]);

      await service.replaceItems('u-1', 'r-1', {
        items: [
          { rawName: ' Milk ', quantity: 2, totalCents: 880, categoryId: 'cat-1' },
          { rawName: 'Bread', quantity: 1, totalCents: 500 },
        ],
      });

      expect(prismaMock.receiptItem.deleteMany).toHaveBeenCalledWith({
        where: { receiptId: 'r-1' },
      });
      const created = prismaMock.receiptItem.createMany.mock.calls[0][0].data;
      expect(created[0]).toMatchObject({ position: 1, rawName: 'Milk', categoryId: 'cat-1' });
      expect(created[1]).toMatchObject({ position: 2, categoryId: null });
    });

    it('rejects categories outside the visible OUT set', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'REVIEW' }));
      categoryMock.list.mockResolvedValue([{ id: 'cat-1', name: 'Groceries' }]);
      try {
        await service.replaceItems('u-1', 'r-1', {
          items: [{ rawName: 'X', quantity: 1, totalCents: 1, categoryId: 'cat-foreign' }],
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('RECEIPT_ITEMS_INVALID');
      }
      expect(prismaMock.receiptItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('searchMerchants (7.8)', () => {
    it('normalizes the query and returns id+name matches', async () => {
      prismaMock.merchant.findMany.mockResolvedValue([{ id: 'm-1', name: 'Café Aroma' }]);
      const out = await service.searchMerchants('  CAFÉ   aroma ');
      expect(prismaMock.merchant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { normalizedName: { contains: 'cafe aroma' } },
          take: 10,
        }),
      );
      expect(out).toEqual([{ id: 'm-1', name: 'Café Aroma' }]);
    });

    it('empty/whitespace queries return [] without touching the DB', async () => {
      await expect(service.searchMerchants('   ')).resolves.toEqual([]);
      expect(prismaMock.merchant.findMany).not.toHaveBeenCalled();
    });
  });

  describe('confirm (7.9)', () => {
    const reviewRow = (over: Record<string, unknown> = {}) =>
      makeRow({
        status: 'REVIEW',
        totalCents: 4590,
        currency: 'ILS',
        purchasedAt: new Date('2026-07-01T12:00:00.000Z'),
        extractedMerchantName: 'Shufersal',
        merchantId: null,
        ...over,
      });

    let txMerchant: { findUnique: jest.Mock; create: jest.Mock };
    let txReceipt: { update: jest.Mock };

    beforeEach(() => {
      txMerchant = { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() };
      txReceipt = { update: jest.fn().mockResolvedValue({}) };
      prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ merchant: txMerchant, receipt: txReceipt }),
      );
      paymentServiceMock.validateExpenseInputs.mockResolvedValue(
        new Date('2026-07-01T12:00:00.000Z'),
      );
      paymentServiceMock.createExpenseWithinTx.mockResolvedValue({
        id: 'p-1',
        createdById: 'u-1',
        attributions: [{ scopeType: 'personal', userId: 'u-1', groupId: null, group: null }],
      });
    });

    it('creates the payment + document, links the receipt, and creates a new merchant', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(reviewRow());
      txMerchant.create.mockResolvedValue({ id: 'm-new', name: 'Shufersal' });
      prismaMock.receipt.findUnique.mockResolvedValue(
        reviewRow({ status: 'CONFIRMED', paymentId: 'p-1', merchantId: 'm-new' }),
      );

      const out = await service.confirm('u-1', 'r-1', {
        categoryId: 'cat-1',
        attributions: [{ scope: 'personal' }],
      });

      expect(paymentServiceMock.validateExpenseInputs).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ amountCents: 4590, currency: 'ILS', categoryId: 'cat-1' }),
      );
      // New merchant created from the reviewed name.
      expect(txMerchant.create).toHaveBeenCalledWith({
        data: { name: 'Shufersal', normalizedName: 'shufersal' },
      });
      // Payment carries the money fields, merchant-name note, and the file document.
      expect(paymentServiceMock.createExpenseWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        'u-1',
        expect.objectContaining({
          amountCents: 4590,
          currency: 'ILS',
          note: 'Shufersal',
          categoryId: 'cat-1',
          document: expect.objectContaining({ kind: 'receipt', fileRef: '2026/07/abc.jpg' }),
        }),
      );
      // Receipt linked to the payment + merchant, marked CONFIRMED.
      expect(txReceipt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CONFIRMED',
            paymentId: 'p-1',
            merchantId: 'm-new',
          }),
        }),
      );
      expect(paymentServiceMock.publishCreated).toHaveBeenCalled();
      const actions = prismaMock.auditLog.create.mock.calls.map((c) => c[0].data.action);
      expect(actions).toEqual(expect.arrayContaining(['RECEIPT_CONFIRMED', 'MERCHANT_CREATED']));
      expect(out.status).toBe('CONFIRMED');
      expect(out.paymentId).toBe('p-1');
    });

    it('reuses an existing registry merchant without creating one', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(reviewRow());
      txMerchant.findUnique.mockResolvedValue({ id: 'm-existing', name: 'Shufersal' });
      prismaMock.receipt.findUnique.mockResolvedValue(
        reviewRow({ status: 'CONFIRMED', paymentId: 'p-1', merchantId: 'm-existing' }),
      );

      await service.confirm('u-1', 'r-1', {
        categoryId: 'cat-1',
        attributions: [{ scope: 'personal' }],
      });

      expect(txMerchant.create).not.toHaveBeenCalled();
      const actions = prismaMock.auditLog.create.mock.calls.map((c) => c[0].data.action);
      expect(actions).toContain('RECEIPT_CONFIRMED');
      expect(actions).not.toContain('MERCHANT_CREATED');
    });

    it('omits the document for a URL receipt with no stored file', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(
        reviewRow({ source: 'url', fileRef: null, extractedMerchantName: null }),
      );
      prismaMock.receipt.findUnique.mockResolvedValue(
        reviewRow({ source: 'url', fileRef: null, status: 'CONFIRMED', paymentId: 'p-1' }),
      );

      await service.confirm('u-1', 'r-1', {
        categoryId: 'cat-1',
        attributions: [{ scope: 'personal' }],
      });

      expect(paymentServiceMock.createExpenseWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        'u-1',
        expect.objectContaining({ document: null }),
      );
      expect(txMerchant.create).not.toHaveBeenCalled(); // no name to register
    });

    it('rejects confirmation outside REVIEW or without total / currency', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(makeRow({ status: 'EXTRACTING' }));
      await expect(
        service.confirm('u-1', 'r-1', { categoryId: 'c', attributions: [{ scope: 'personal' }] }),
      ).rejects.toMatchObject({});
      expect(prismaMock.$transaction).not.toHaveBeenCalled();

      prismaMock.receipt.findFirst.mockResolvedValue(reviewRow({ totalCents: null }));
      try {
        await service.confirm('u-1', 'r-1', {
          categoryId: 'c',
          attributions: [{ scope: 'personal' }],
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('RECEIPT_INVALID_STATE');
      }

      prismaMock.receipt.findFirst.mockResolvedValue(reviewRow({ currency: null }));
      try {
        await service.confirm('u-1', 'r-1', {
          categoryId: 'c',
          attributions: [{ scope: 'personal' }],
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe('RECEIPT_INVALID_STATE');
      }
      expect(paymentServiceMock.createExpenseWithinTx).not.toHaveBeenCalled();
    });

    it('propagates payment-input validation failures before writing', async () => {
      prismaMock.receipt.findFirst.mockResolvedValue(reviewRow());
      paymentServiceMock.validateExpenseInputs.mockRejectedValue(new Error('bad category'));
      await expect(
        service.confirm('u-1', 'r-1', { categoryId: 'c', attributions: [{ scope: 'personal' }] }),
      ).rejects.toThrow('bad category');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
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
