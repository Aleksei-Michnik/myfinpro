import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductMatchingService } from '../product/product-matching.service';
import { EventBus } from '../realtime/event-bus.service';
import { ExtractionFailedError } from './extraction/extraction-provider.interface';
import { ExtractionResolverService } from './extraction/extraction-resolver.service';
import { ReceiptExtractionProcessor } from './receipt-extraction.processor';
import { ReceiptStorageService } from './receipt-storage.service';
import { ReceiptUrlIntakeService } from './url-intake/receipt-url-intake.service';

describe('ReceiptExtractionProcessor', () => {
  const prismaMock = {
    receipt: { findUnique: jest.fn(), update: jest.fn() },
    receiptFile: { findMany: jest.fn() },
    receiptItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  const storageMock = { read: jest.fn() };
  const categoryMock = { list: jest.fn() };
  const eventBusMock = { publish: jest.fn() };
  const providerMock = { name: 'mock', extract: jest.fn() };
  // Phase 8.11 — the worker resolves the provider per uploader.
  const resolverMock = {
    resolveForUser: jest.fn().mockResolvedValue({
      provider: providerMock,
      providerName: 'mock',
      model: null,
      keySource: 'default',
    }),
  };
  const matcherMock = {
    getUserProductCandidates: jest.fn(),
    matchItems: jest.fn(),
  };
  // Phase 8.17 — URL fetch/route/politeness/logging lives in the intake
  // service now; the worker only delegates. Its own routing is covered by
  // receipt-url-intake.service.spec.ts.
  const urlIntakeMock = { resolve: jest.fn(), recordUrlOutcome: jest.fn() };

  let processor: ReceiptExtractionProcessor;

  const makeReceipt = (over: Record<string, unknown> = {}) => ({
    id: 'r-1',
    status: 'UPLOADED',
    source: 'upload',
    sourceUrl: null,
    uploadedById: 'u-1',
    uploadedBy: { id: 'u-1', locale: 'en' },
    items: [],
    files: [],
    merchant: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const okResult = () => ({
    merchantName: 'Store',
    purchasedAt: '2026-07-01T10:00:00.000Z',
    currency: 'USD',
    totalCents: 880,
    discountCents: 0,
    items: [
      {
        rawName: 'Milk',
        quantity: 2,
        unitPriceCents: 440,
        discountCents: 0,
        totalCents: 880,
        suggestedCategoryId: 'cat-1',
        suggestedProductId: null,
      },
      {
        rawName: 'Mystery',
        quantity: 1,
        unitPriceCents: null,
        discountCents: 0,
        totalCents: 0,
        suggestedCategoryId: 'cat-INVENTED',
        suggestedProductId: 'prod-INVENTED',
      },
    ],
    confidence: 'high' as const,
    notes: null,
  });

  /** Phase 8.17 — nothing usable read: no merchant, no total, no items. */
  const emptyResult = () => ({
    merchantName: null,
    purchasedAt: null,
    currency: null,
    totalCents: null,
    discountCents: 0,
    items: [],
    confidence: 'low' as const,
    notes: null,
  });

  const makeJob = (attemptsMade = 0, attempts = 3) =>
    ({ data: { receiptId: 'r-1' }, attemptsMade, opts: { attempts } }) as Job<{
      receiptId: string;
    }>;

  /** A URL-sourced receipt — its content resolution is delegated to the intake service. */
  const urlReceipt = (over: Record<string, unknown> = {}) =>
    makeReceipt({
      source: 'url',
      sourceUrl: 'https://r.example/x',
      ...over,
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ receipt: prismaMock.receipt, receiptItem: prismaMock.receiptItem }),
    );
    prismaMock.receipt.update.mockResolvedValue({});
    categoryMock.list.mockResolvedValue([
      { id: 'cat-1', name: 'Groceries' },
      { id: 'cat-2', name: 'Household' },
    ]);
    storageMock.read.mockResolvedValue(Buffer.from('image-bytes'));
    prismaMock.receiptFile.findMany.mockResolvedValue([
      { fileRef: '2026/07/x.jpg', mimeType: 'image/jpeg' },
    ]);
    prismaMock.product.findMany.mockResolvedValue([]);
    matcherMock.getUserProductCandidates.mockResolvedValue([
      { id: 'prod-1', name: 'Milk 3%', brand: null },
    ]);
    matcherMock.matchItems.mockImplementation((items: unknown[]) =>
      Promise.resolve(items.map(() => ({ candidates: [], autoProductId: null }))),
    );
    urlIntakeMock.recordUrlOutcome.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptExtractionProcessor,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ReceiptStorageService, useValue: storageMock },
        { provide: CategoryService, useValue: categoryMock },
        { provide: ProductMatchingService, useValue: matcherMock },
        { provide: EventBus, useValue: eventBusMock },
        { provide: ExtractionResolverService, useValue: resolverMock },
        { provide: ReceiptUrlIntakeService, useValue: urlIntakeMock },
      ],
    }).compile();
    processor = module.get(ReceiptExtractionProcessor);
  });

  it('happy path: image upload → EXTRACTING → provider → REVIEW with filtered items', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt());
    providerMock.extract.mockResolvedValue(okResult());

    const outcome = await processor.process(makeJob());

    expect(outcome).toEqual({ extracted: true, receiptId: 'r-1', items: 2 });
    // Provider got an image input + the OUT candidate list + locale.
    const [input, ctx] = providerMock.extract.mock.calls[0];
    expect(input.kind).toBe('image');
    expect(input.pages).toEqual([{ data: Buffer.from('image-bytes'), mimeType: 'image/jpeg' }]);
    expect(ctx.categories).toEqual([
      { id: 'cat-1', name: 'Groceries' },
      { id: 'cat-2', name: 'Household' },
    ]);
    expect(ctx.locale).toBe('en');
    expect(categoryMock.list).toHaveBeenCalledWith('u-1', { direction: 'OUT' });
    // Phase 8 — product candidates ride the same extraction call.
    expect(ctx.products).toEqual([{ id: 'prod-1', name: 'Milk 3%', brand: null }]);

    // Phase 8 — the staged matcher runs per item, with invented LLM product
    // ids dropped before they reach it.
    expect(matcherMock.matchItems).toHaveBeenCalledWith(
      [
        { rawName: 'Milk', suggestedProductId: null },
        { rawName: 'Mystery', suggestedProductId: null }, // prod-INVENTED dropped
      ],
      'high',
    );

    // Header persisted + REVIEW; items replaced with positions; the invented
    // category id got dropped to null.
    const reviewUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'REVIEW',
    );
    expect(reviewUpdate[0].data.extractedMerchantName).toBe('Store');
    const created = prismaMock.receiptItem.createMany.mock.calls[0][0].data;
    expect(created[0]).toMatchObject({ position: 1, categoryId: 'cat-1', matchStatus: 'PENDING' });
    expect(created[1]).toMatchObject({ position: 2, categoryId: null, productId: null });

    // Realtime fan-out on both transitions.
    expect(eventBusMock.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'receipt.updated', userIds: ['u-1'] }),
    );
  });

  it('auto-links deterministic high-confidence matches and backfills the default category', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt());
    providerMock.extract.mockResolvedValue(okResult());
    matcherMock.matchItems.mockResolvedValue([
      { candidates: [], autoProductId: null },
      {
        candidates: [
          {
            productId: 'prod-9',
            name: 'Mystery Snack',
            brand: null,
            stage: 'alias',
            confidence: 0.96,
          },
        ],
        autoProductId: 'prod-9',
      },
    ]);
    // The auto-linked product's default category backfills the empty line —
    // but only because cat-2 is in the uploader's candidate set.
    prismaMock.product.findMany.mockResolvedValue([{ id: 'prod-9', defaultCategoryId: 'cat-2' }]);

    await processor.process(makeJob());

    const created = prismaMock.receiptItem.createMany.mock.calls[0][0].data;
    expect(created[1]).toMatchObject({
      productId: 'prod-9',
      matchStatus: 'AUTO',
      categoryId: 'cat-2',
    });
    expect(created[1].matchCandidates).toEqual([
      { productId: 'prod-9', name: 'Mystery Snack', brand: null, stage: 'alias', confidence: 0.96 },
    ]);
  });

  it('pdf uploads become native document inputs', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt());
    prismaMock.receiptFile.findMany.mockResolvedValue([
      { fileRef: '2026/07/x.pdf', mimeType: 'application/pdf' },
    ]);
    providerMock.extract.mockResolvedValue(okResult());
    await processor.process(makeJob());
    expect(providerMock.extract.mock.calls[0][0].kind).toBe('pdf');
  });

  it('multi-photo receipts ride as ordered pages of one image input (8.22)', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt());
    prismaMock.receiptFile.findMany.mockResolvedValue([
      { fileRef: '2026/07/p1.jpg', mimeType: 'image/jpeg' },
      { fileRef: '2026/07/p2.png', mimeType: 'image/png' },
    ]);
    storageMock.read
      .mockResolvedValueOnce(Buffer.from('page-1'))
      .mockResolvedValueOnce(Buffer.from('page-2'));
    providerMock.extract.mockResolvedValue(okResult());

    await processor.process(makeJob());

    const [input] = providerMock.extract.mock.calls[0];
    expect(input.kind).toBe('image');
    expect(input.pages).toEqual([
      { data: Buffer.from('page-1'), mimeType: 'image/jpeg' },
      { data: Buffer.from('page-2'), mimeType: 'image/png' },
    ]);
  });

  it('url sources delegate resolution to the intake service', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    urlIntakeMock.resolve.mockResolvedValue({
      kind: 'html',
      data: 'Shufersal receipt 45.90',
      sourceUrl: 'https://r.example/x',
    });
    providerMock.extract.mockResolvedValue(okResult());

    await processor.process(makeJob());

    expect(urlIntakeMock.resolve).toHaveBeenCalledWith('https://r.example/x');
    const input = providerMock.extract.mock.calls[0][0];
    expect(input.kind).toBe('html');
    expect(input.data).toBe('Shufersal receipt 45.90');
    expect(input.sourceUrl).toBe('https://r.example/x');
  });

  it('an intake-service failure fails the receipt permanently with its guidance', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    urlIntakeMock.resolve.mockRejectedValue(
      new ExtractionFailedError('Receipt URL returned an unsupported file type'),
    );

    const outcome = await processor.process(makeJob());

    expect(outcome).toEqual({ extracted: false, reason: 'permanent_failure' });
    const failUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failUpdate[0].data.failureReason).toContain('unsupported file type');
    expect(providerMock.extract).not.toHaveBeenCalled();
  });

  it('an all-empty extraction fails with guidance instead of a blank REVIEW (upload)', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt());
    providerMock.extract.mockResolvedValue(emptyResult());

    const outcome = await processor.process(makeJob());

    expect(outcome).toEqual({ extracted: false, reason: 'permanent_failure' });
    const failUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failUpdate[0].data.failureReason).toContain('Could not read any receipt details');
    // No REVIEW transition, no items written.
    expect(
      prismaMock.receipt.update.mock.calls.find((c) => c[0].data.status === 'REVIEW'),
    ).toBeUndefined();
    expect(prismaMock.receiptItem.createMany).not.toHaveBeenCalled();
    // Upload source → nothing to record in the URL intake log.
    expect(urlIntakeMock.recordUrlOutcome).not.toHaveBeenCalled();
  });

  it('an all-empty extraction on a URL records the anonymized outcome and guides to upload', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    urlIntakeMock.resolve.mockResolvedValue({
      kind: 'html',
      data: 'Loading...',
      sourceUrl: 'https://r.example/x',
    });
    providerMock.extract.mockResolvedValue(emptyResult());

    const outcome = await processor.process(makeJob());

    expect(outcome).toEqual({ extracted: false, reason: 'permanent_failure' });
    const failUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failUpdate[0].data.failureReason).toContain('load its content in the browser');
    // Anonymized signal so we can spot a provider worth adapting.
    expect(urlIntakeMock.recordUrlOutcome).toHaveBeenCalledWith(
      'https://r.example/x',
      null,
      'empty_result',
    );
  });

  it('duplicate fires are no-ops for REVIEW / CONFIRMED / FAILED receipts', async () => {
    for (const status of ['REVIEW', 'CONFIRMED', 'FAILED']) {
      prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt({ status }));
      const outcome = await processor.process(makeJob());
      expect(outcome).toEqual({ extracted: false, reason: `status_${status.toLowerCase()}` });
    }
    expect(providerMock.extract).not.toHaveBeenCalled();
  });

  it('a missing receipt is skipped, not retried', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(null);
    await expect(processor.process(makeJob())).resolves.toEqual({
      extracted: false,
      reason: 'receipt_missing',
    });
  });

  it('permanent provider failure → FAILED with reason, swallowed (no BullMQ retry)', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt());
    providerMock.extract.mockRejectedValue(new ExtractionFailedError('unreadable document'));

    const outcome = await processor.process(makeJob(0, 3));

    expect(outcome).toEqual({ extracted: false, reason: 'permanent_failure' });
    const failUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failUpdate[0].data.failureReason).toBe('unreadable document');
  });

  it('transient failure re-throws for BullMQ retry, without failing the receipt early', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt());
    providerMock.extract.mockRejectedValue(new Error('529 overloaded'));

    await expect(processor.process(makeJob(0, 3))).rejects.toThrow('529 overloaded');
    const failUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failUpdate).toBeUndefined();
  });

  it('transient failure on the FINAL attempt marks FAILED and still re-throws', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(makeReceipt({ status: 'EXTRACTING' }));
    providerMock.extract.mockRejectedValue(new Error('529 overloaded'));

    await expect(processor.process(makeJob(2, 3))).rejects.toThrow('529 overloaded');
    const failUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failUpdate[0].data.failureReason).toContain('529');
  });
});
