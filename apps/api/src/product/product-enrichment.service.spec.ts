import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_ENRICHMENTS_QUEUE } from '../queue/queue.constants';
import { OpenFoodFactsService } from './open-food-facts.service';
import { ProductEnrichmentService } from './product-enrichment.service';
import { ProductImageService } from './product-image.service';
import { ProductService } from './product.service';

describe('ProductEnrichmentService', () => {
  const prismaMock = {
    product: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  };
  const offMock = { lookup: jest.fn(), isEnabled: true };
  const productsMock = { recordAlias: jest.fn().mockResolvedValue(undefined) };
  const imagesMock = { addFromUrl: jest.fn().mockResolvedValue(undefined) };
  const queueMock = { upsertJobScheduler: jest.fn().mockResolvedValue({}) };

  let service: ProductEnrichmentService;

  const makeRow = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    barcode: '7290000066318',
    brand: null,
    images: [],
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    offMock.isEnabled = true;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductEnrichmentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: OpenFoodFactsService, useValue: offMock },
        { provide: ProductService, useValue: productsMock },
        { provide: ProductImageService, useValue: imagesMock },
        { provide: getQueueToken(PRODUCT_ENRICHMENTS_QUEUE), useValue: queueMock },
      ],
    }).compile();
    service = module.get(ProductEnrichmentService);
  });

  describe('onApplicationBootstrap', () => {
    it('upserts the nightly scheduler under a deterministic id', () => {
      service.onApplicationBootstrap();
      expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
        'product-enrichment-nightly',
        { pattern: '10 3 * * *' },
        expect.objectContaining({ name: 'enrich-unchecked' }),
      );
    });

    it('does not schedule when OFF is disabled', () => {
      offMock.isEnabled = false;
      service.onApplicationBootstrap();
      expect(queueMock.upsertJobScheduler).not.toHaveBeenCalled();
    });
  });

  describe('enrichUnchecked', () => {
    it('fills brand, records an off alias, queues the image, stamps checked', async () => {
      prismaMock.product.findMany.mockResolvedValue([makeRow()]);
      offMock.lookup.mockResolvedValue({
        status: 'hit',
        name: 'Nutella',
        brand: 'Ferrero',
        imageUrl: 'https://images.example/n.jpg',
      });

      const out = await service.enrichUnchecked();

      expect(out).toEqual({ scanned: 1, enriched: 1, missed: 0, halted: false });
      // Only never-checked barcodes are swept.
      expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({
        barcode: { not: null },
        offCheckedAt: null,
      });
      expect(prismaMock.product.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'p-1' },
        data: { brand: 'Ferrero', offCheckedAt: expect.any(Date) },
      });
      expect(productsMock.recordAlias).toHaveBeenCalledWith(
        prismaMock,
        null, // system action — no user behind it
        'p-1',
        'Nutella',
        null,
        'off',
      );
      expect(imagesMock.addFromUrl).toHaveBeenCalledWith('p-1', 'https://images.example/n.jpg');
    });

    it('never overwrites an existing brand or image', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        makeRow({ brand: 'House Brand', images: [{ id: 'img-1' }] }),
      ]);
      offMock.lookup.mockResolvedValue({
        status: 'hit',
        name: 'Nutella',
        brand: 'Ferrero',
        imageUrl: 'https://images.example/n.jpg',
      });

      await service.enrichUnchecked();

      expect(prismaMock.product.update.mock.calls[0][0].data).toEqual({
        offCheckedAt: expect.any(Date),
      });
      expect(imagesMock.addFromUrl).not.toHaveBeenCalled();
    });

    it('a clean miss is stamped checked so it is not re-asked nightly', async () => {
      prismaMock.product.findMany.mockResolvedValue([makeRow()]);
      offMock.lookup.mockResolvedValue({ status: 'miss' });

      const out = await service.enrichUnchecked();

      expect(out).toEqual({ scanned: 1, enriched: 0, missed: 1, halted: false });
      expect(prismaMock.product.update.mock.calls[0][0].data).toEqual({
        offCheckedAt: expect.any(Date),
      });
      expect(productsMock.recordAlias).not.toHaveBeenCalled();
    });

    it('halts on OFF unavailability leaving the remainder unstamped', async () => {
      prismaMock.product.findMany.mockResolvedValue([makeRow(), makeRow({ id: 'p-2' })]);
      offMock.lookup.mockResolvedValue({ status: 'unavailable' });

      const out = await service.enrichUnchecked();

      expect(out).toEqual({ scanned: 0, enriched: 0, missed: 0, halted: true });
      expect(offMock.lookup).toHaveBeenCalledTimes(1);
      expect(prismaMock.product.update).not.toHaveBeenCalled();
    });
  });
});
