import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OpenFoodFactsService } from './open-food-facts.service';
import { ProductImageService } from './product-image.service';
import { ProductMatchingService } from './product-matching.service';
import { ProductService } from './product.service';

const codeOf = (err: unknown): string | undefined =>
  ((err as { getResponse?: () => { errorCode?: string } }).getResponse?.() ?? {}).errorCode;

describe('ProductService', () => {
  const prismaMock = {
    product: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    productAlias: { upsert: jest.fn() },
    receiptItem: { groupBy: jest.fn(), findMany: jest.fn() },
    category: { findUnique: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const matcherMock = { searchRegistry: jest.fn() };
  const offMock = { lookup: jest.fn() };
  const imagesMock = { enqueueUrlFetch: jest.fn().mockResolvedValue(undefined) };

  let service: ProductService;

  const makeProduct = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    barcode: null,
    name: 'Milk 3%',
    normalizedName: 'milk 3%',
    brand: null,
    imageRef: null,
    defaultCategoryId: null,
    createdAt: new Date('2026-07-10T10:00:00.000Z'),
    updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.receiptItem.groupBy.mockResolvedValue([]);
    prismaMock.receiptItem.findMany.mockResolvedValue([]);
    prismaMock.product.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProductMatchingService, useValue: matcherMock },
        { provide: OpenFoodFactsService, useValue: offMock },
        { provide: ProductImageService, useValue: imagesMock },
      ],
    }).compile();
    service = module.get(ProductService);
  });

  describe('create', () => {
    it('normalizes the name, validates + normalizes the barcode, seeds the alias', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null); // barcode free
      prismaMock.product.create.mockResolvedValue(makeProduct({ barcode: '7290000066318' }));

      await service.create('u-1', {
        name: '  Milk   3% ',
        barcode: ' 729-0000-066318 ',
        aliasLocale: 'en',
      });

      const args = prismaMock.product.create.mock.calls[0][0].data;
      expect(args).toMatchObject({
        name: 'Milk   3%',
        normalizedName: 'milk 3%',
        barcode: '7290000066318',
      });
      expect(args.aliases.create).toMatchObject({
        normalizedName: 'milk 3%',
        source: 'manual',
        locale: 'en',
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'PRODUCT_CREATED' }) }),
      );
    });

    it('rejects invalid GTINs and taken barcodes with structured codes', async () => {
      await expect(service.create('u-1', { name: 'X', barcode: '12345' })).rejects.toMatchObject(
        expect.any(BadRequestException),
      );
      await service
        .create('u-1', { name: 'X', barcode: '12345' })
        .catch((err) => expect(codeOf(err)).toBe('PRODUCT_INVALID_BARCODE'));

      prismaMock.product.findUnique.mockResolvedValue({ id: 'other' });
      await service
        .create('u-1', { name: 'X', barcode: '7290000066318' })
        .catch((err) => expect(codeOf(err)).toBe('PRODUCT_BARCODE_TAKEN'));
    });

    it('only accepts SYSTEM expense categories as the global default', async () => {
      prismaMock.category.findUnique.mockResolvedValue({ ownerType: 'user', direction: 'OUT' });
      await service
        .create('u-1', { name: 'X', defaultCategoryId: '3f1e9f4e-0000-0000-0000-000000000000' })
        .catch((err) => expect(codeOf(err)).toBe('PRODUCT_INVALID_CATEGORY'));

      prismaMock.category.findUnique.mockResolvedValue({ ownerType: 'system', direction: 'OUT' });
      prismaMock.product.create.mockResolvedValue(makeProduct());
      await expect(
        service.create('u-1', {
          name: 'X',
          defaultCategoryId: '3f1e9f4e-0000-0000-0000-000000000000',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    it('re-normalizes on rename and allows keeping your own barcode', async () => {
      prismaMock.product.findUnique
        .mockResolvedValueOnce(makeProduct({ barcode: '7290000066318' })) // load
        .mockResolvedValueOnce({ id: 'p-1' }); // barcode owner = self
      prismaMock.product.update.mockResolvedValue(makeProduct({ name: 'Whole Milk' }));

      await service.update('u-1', 'p-1', { name: ' Whole  Milk ', barcode: '7290000066318' });
      expect(prismaMock.product.update.mock.calls[0][0].data).toMatchObject({
        name: 'Whole  Milk',
        normalizedName: 'whole milk',
        barcode: '7290000066318',
      });
    });

    it('404s cleanly on unknown products', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);
      await expect(service.update('u-1', 'nope', { name: 'X' })).rejects.toMatchObject(
        expect.any(NotFoundException),
      );
    });
  });

  describe('recordAlias (registry auto-update, 8.5)', () => {
    it('upserts on (productId, normalizedName) and bumps the counter', async () => {
      await service.recordAlias(
        prismaMock as never,
        'u-1',
        'p-1',
        ' חלב  3% ',
        'he',
        'confirmation',
      );
      const args = prismaMock.productAlias.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        productId_normalizedName: { productId: 'p-1', normalizedName: 'חלב 3%' },
      });
      expect(args.create).toMatchObject({ name: 'חלב  3%', locale: 'he', source: 'confirmation' });
      expect(args.update).toMatchObject({ confirmationCount: { increment: 1 }, locale: 'he' });
    });

    it('ignores blank names', async () => {
      await service.recordAlias(prismaMock as never, 'u-1', 'p-1', '   ', null, 'confirmation');
      expect(prismaMock.productAlias.upsert).not.toHaveBeenCalled();
    });
  });

  describe('lookupBarcode', () => {
    it('prefers the local registry and skips OFF on a hit', async () => {
      prismaMock.product.findUnique.mockResolvedValue(makeProduct({ barcode: '96385074' }));
      const out = await service.lookupBarcode('u-1', '96385074');
      expect(out.found).toBe(true);
      expect(out.offStatus).toBe('registry');
      expect(offMock.lookup).not.toHaveBeenCalled();
    });

    it('returns the OFF prefill on a registry miss', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);
      offMock.lookup.mockResolvedValue({
        status: 'hit',
        name: 'Nutella',
        brand: 'Ferrero',
        imageUrl: 'https://images.example/n.jpg',
      });
      const out = await service.lookupBarcode('u-1', '3017620422003');
      expect(out).toMatchObject({
        found: false,
        offStatus: 'off',
        prefill: { name: 'Nutella', brand: 'Ferrero' },
      });
    });

    it('degrades gracefully when OFF is down or disabled', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);
      offMock.lookup.mockResolvedValue({ status: 'unavailable' });
      await expect(service.lookupBarcode('u-1', '96385074')).resolves.toMatchObject({
        found: false,
        offStatus: 'unavailable',
      });
    });

    it('rejects non-GTIN input', async () => {
      await service
        .lookupBarcode('u-1', 'not-a-barcode')
        .catch((err) => expect(codeOf(err)).toBe('PRODUCT_INVALID_BARCODE'));
    });
  });

  describe('purchases', () => {
    it('aggregates per merchant from the caller-scoped rows', async () => {
      prismaMock.product.findUnique.mockResolvedValue({ id: 'p-1' });
      prismaMock.receiptItem.findMany.mockResolvedValue([
        {
          receiptId: 'r-2',
          purchasedAt: new Date('2026-07-10T10:00:00.000Z'),
          quantity: 1,
          unitPriceCents: 500,
          totalCents: 500,
          receipt: { currency: 'ILS', merchant: { name: 'Shufersal' } },
        },
        {
          receiptId: 'r-1',
          purchasedAt: new Date('2026-07-01T10:00:00.000Z'),
          quantity: 2,
          unitPriceCents: 450,
          totalCents: 900,
          receipt: { currency: 'ILS', merchant: { name: 'Shufersal' } },
        },
      ]);

      const out = await service.purchases('u-1', 'p-1');
      expect(out.purchases).toHaveLength(2);
      expect(out.merchants).toEqual([
        {
          merchantName: 'Shufersal',
          purchases: 2,
          lastUnitPriceCents: 500,
          minUnitPriceCents: 450,
          maxUnitPriceCents: 500,
          lastPurchasedAt: '2026-07-10T10:00:00.000Z',
        },
      ]);
      // The privacy boundary: the query is pinned to the caller + CONFIRMED.
      expect(prismaMock.receiptItem.findMany.mock.calls[0][0].where).toMatchObject({
        productId: 'p-1',
        receipt: { uploadedById: 'u-1', status: 'CONFIRMED' },
      });
    });
  });
});
