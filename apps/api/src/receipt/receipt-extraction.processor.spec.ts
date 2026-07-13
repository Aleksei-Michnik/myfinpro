import { RECEIPT_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
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

describe('ReceiptExtractionProcessor', () => {
  const prismaMock = {
    receipt: { findUnique: jest.fn(), update: jest.fn() },
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

  let processor: ReceiptExtractionProcessor;

  const makeReceipt = (over: Record<string, unknown> = {}) => ({
    id: 'r-1',
    status: 'UPLOADED',
    source: 'upload',
    fileRef: '2026/07/x.jpg',
    mimeType: 'image/jpeg',
    sourceUrl: null,
    uploadedById: 'u-1',
    uploadedBy: { id: 'u-1', locale: 'en' },
    items: [],
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

  const makeJob = (attemptsMade = 0, attempts = 3) =>
    ({ data: { receiptId: 'r-1' }, attemptsMade, opts: { attempts } }) as Job<{
      receiptId: string;
    }>;

  /** Phase 8.12 — URL receipts are fetched as bytes and routed by content. */
  const urlReceipt = (over: Record<string, unknown> = {}) =>
    makeReceipt({
      source: 'url',
      fileRef: null,
      mimeType: null,
      sourceUrl: 'https://r.example/x',
      ...over,
    });
  const urlFetchResponse = (body: string | Buffer, contentType: string) => {
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    return {
      ok: true,
      headers: new Headers({ 'content-type': contentType }),
      arrayBuffer: () =>
        Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    } as unknown as Response;
  };

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
    prismaMock.product.findMany.mockResolvedValue([]);
    matcherMock.getUserProductCandidates.mockResolvedValue([
      { id: 'prod-1', name: 'Milk 3%', brand: null },
    ]);
    matcherMock.matchItems.mockImplementation((items: unknown[]) =>
      Promise.resolve(items.map(() => ({ candidates: [], autoProductId: null }))),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptExtractionProcessor,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ReceiptStorageService, useValue: storageMock },
        { provide: CategoryService, useValue: categoryMock },
        { provide: ProductMatchingService, useValue: matcherMock },
        { provide: EventBus, useValue: eventBusMock },
        { provide: ExtractionResolverService, useValue: resolverMock },
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
    expect(input.mimeType).toBe('image/jpeg');
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

  it('pdf uploads become document inputs; url sources fetch a snapshot', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(
      makeReceipt({ mimeType: 'application/pdf', fileRef: '2026/07/x.pdf' }),
    );
    providerMock.extract.mockResolvedValue(okResult());
    await processor.process(makeJob());
    expect(providerMock.extract.mock.calls[0][0].kind).toBe('pdf');

    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ receipt: prismaMock.receipt, receiptItem: prismaMock.receiptItem }),
    );
    categoryMock.list.mockResolvedValue([]);
    prismaMock.receipt.update.mockResolvedValue({});
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    providerMock.extract.mockResolvedValue(okResult());
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        urlFetchResponse(
          '<html><head><script>track()</script></head><body><p>Shufersal receipt 45.90</p></body></html>',
          'text/html; charset=utf-8',
        ),
      );

    await processor.process(makeJob());
    const input = providerMock.extract.mock.calls[0][0];
    expect(input.kind).toBe('html');
    expect(input.sourceUrl).toBe('https://r.example/x');
    // 7.12 — HTML reduces to readable text before the provider call.
    expect(input.data).toBe('Shufersal receipt 45.90');
    fetchSpy.mockRestore();
  });

  it('a URL serving a PDF routes to the native document input', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    providerMock.extract.mockResolvedValue(okResult());
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0x00, 0x01, 0x02])]);
    // Deliberately vague content-type — the magic bytes must decide.
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(urlFetchResponse(pdf, 'application/octet-stream'));

    await processor.process(makeJob());
    const input = providerMock.extract.mock.calls[0][0];
    expect(input.kind).toBe('pdf');
    expect(Buffer.from(input.data).subarray(0, 5).toString()).toBe('%PDF-');
    fetchSpy.mockRestore();
  });

  it('a URL serving an image (even mislabelled as HTML) routes to the vision input', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    providerMock.extract.mockResolvedValue(okResult());
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(urlFetchResponse(png, 'text/html'));

    await processor.process(makeJob());
    const input = providerMock.extract.mock.calls[0][0];
    expect(input.kind).toBe('image');
    expect(input.mimeType).toBe('image/png');
    fetchSpy.mockRestore();
  });

  it('oversized and unsupported binary URL content fail permanently', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        urlFetchResponse(Buffer.alloc(RECEIPT_MAX_FILE_SIZE_BYTES + 1), 'application/pdf'),
      );
    await expect(processor.process(makeJob())).resolves.toEqual({
      extracted: false,
      reason: 'permanent_failure',
    });
    let failUpdate = prismaMock.receipt.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failUpdate[0].data.failureReason).toContain('limit');

    jest.clearAllMocks();
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    prismaMock.receipt.update.mockResolvedValue({});
    categoryMock.list.mockResolvedValue([]);
    matcherMock.getUserProductCandidates.mockResolvedValue([]);
    // Unknown binary (NUL bytes, no recognised magic) — never mojibake at
    // the model, always a clear failure reason.
    fetchSpy.mockResolvedValue(
      urlFetchResponse(Buffer.from('BLOB\0\0\0garbage'), 'application/octet-stream'),
    );
    await expect(processor.process(makeJob())).resolves.toEqual({
      extracted: false,
      reason: 'permanent_failure',
    });
    failUpdate = prismaMock.receipt.update.mock.calls.find((c) => c[0].data.status === 'FAILED');
    expect(failUpdate[0].data.failureReason).toContain('unsupported file type');
    expect(providerMock.extract).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('HTML receipt lines deep past huge script blobs still reach the provider', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(urlReceipt());
    providerMock.extract.mockResolvedValue(okResult());
    // 600 KB of inline script BEFORE the items — a raw-HTML cap would have
    // cut the receipt content off; reduce-then-cap keeps it (Phase 8.12).
    const html = `<html><body><script>${'x'.repeat(600_000)}</script><p>Total 45.90</p></body></html>`;
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(urlFetchResponse(html, 'text/html'));

    await processor.process(makeJob());
    const input = providerMock.extract.mock.calls[0][0];
    expect(input.kind).toBe('html');
    expect(input.data).toContain('Total 45.90');
    fetchSpy.mockRestore();
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

  it('a dead receipt URL (404) is a permanent failure', async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(
      makeReceipt({ source: 'url', fileRef: null, sourceUrl: 'https://r.example/gone' }),
    );
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 404 } as never);

    const outcome = await processor.process(makeJob());
    expect(outcome).toEqual({ extracted: false, reason: 'permanent_failure' });
    fetchSpy.mockRestore();
  });
});
