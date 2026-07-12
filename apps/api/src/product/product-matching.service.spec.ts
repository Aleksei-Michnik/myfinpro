import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ProductMatchingService } from './product-matching.service';

describe('ProductMatchingService', () => {
  const prismaMock = {
    product: { findMany: jest.fn(), findUnique: jest.fn() },
    productAlias: { findMany: jest.fn() },
    receiptItem: { groupBy: jest.fn() },
  };

  let service: ProductMatchingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.product.findMany.mockResolvedValue([]);
    prismaMock.product.findUnique.mockResolvedValue(null);
    prismaMock.productAlias.findMany.mockResolvedValue([]);
    prismaMock.receiptItem.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductMatchingService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = module.get(ProductMatchingService);
  });

  const heads = (rows: { id: string; name: string; brand?: string | null }[]) =>
    rows.map((r) => ({ id: r.id, name: r.name, brand: r.brand ?? null }));

  it('alias stage wins over exact, confirmation count raises confidence, auto-links', async () => {
    prismaMock.productAlias.findMany.mockImplementation(({ where }: { where: unknown }) =>
      Promise.resolve(
        JSON.stringify(where).includes('"in"')
          ? [
              { productId: 'p-1', normalizedName: 'milk 3%', confirmationCount: 4 },
              { productId: 'p-2', normalizedName: 'milk 3%', confirmationCount: 1 },
            ]
          : [],
      ),
    );
    prismaMock.product.findMany.mockImplementation(({ where }: { where: { id?: unknown } }) =>
      Promise.resolve(
        where.id
          ? heads([
              { id: 'p-1', name: 'Milk 3%', brand: 'Tnuva' },
              { id: 'p-2', name: 'Other Milk' },
            ])
          : [],
      ),
    );

    const [proposal] = await service.matchItems([{ rawName: '  Milk   3% ' }]);
    expect(proposal.autoProductId).toBe('p-1'); // most-confirmed alias wins
    expect(proposal.candidates[0]).toMatchObject({
      productId: 'p-1',
      stage: 'alias',
      name: 'Milk 3%',
      brand: 'Tnuva',
    });
    expect(proposal.candidates[0].confidence).toBeGreaterThan(0.95);
  });

  it('exact canonical-name hits auto-link at 0.9', async () => {
    prismaMock.product.findMany.mockImplementation(
      ({ where }: { where: { normalizedName?: unknown; id?: unknown } }) => {
        if (where.normalizedName) {
          return Promise.resolve([{ id: 'p-3', normalizedName: 'tomatoes' }]);
        }
        if (where.id) return Promise.resolve(heads([{ id: 'p-3', name: 'Tomatoes' }]));
        return Promise.resolve([]);
      },
    );
    const [proposal] = await service.matchItems([{ rawName: 'Tomatoes' }]);
    expect(proposal.autoProductId).toBe('p-3');
    expect(proposal.candidates[0]).toMatchObject({ stage: 'exact', confidence: 0.9 });
  });

  it('fuzzy candidates never auto-link; llm suggestions merge with extraction confidence', async () => {
    // Fuzzy pool: a near-spelling alias for p-4.
    prismaMock.productAlias.findMany.mockImplementation(({ where }: { where: unknown }) =>
      Promise.resolve(
        JSON.stringify(where).includes('contains')
          ? [{ productId: 'p-4', normalizedName: 'organic tomatoes 1kg', confirmationCount: 1 }]
          : [],
      ),
    );
    prismaMock.product.findMany.mockImplementation(({ where }: { where: { id?: unknown } }) =>
      Promise.resolve(
        where.id
          ? heads([
              { id: 'p-4', name: 'Organic Tomatoes' },
              { id: 'p-5', name: 'עגבניות' },
            ])
          : [],
      ),
    );

    const [proposal] = await service.matchItems(
      [{ rawName: 'organic tomatoes', suggestedProductId: 'p-5' }],
      'high',
    );
    expect(proposal.autoProductId).toBeNull();
    const stages = Object.fromEntries(proposal.candidates.map((c) => [c.productId, c]));
    expect(stages['p-4'].stage).toBe('fuzzy');
    expect(stages['p-4'].confidence).toBeLessThan(0.9);
    // Cross-language LLM proposal rides along at the high-confidence tier.
    expect(stages['p-5']).toMatchObject({ stage: 'llm', confidence: 0.8 });
  });

  it('returns empty proposals for empty input without touching the DB', async () => {
    await expect(service.matchItems([])).resolves.toEqual([]);
    expect(prismaMock.productAlias.findMany).not.toHaveBeenCalled();
  });

  it('searchRegistry resolves barcodes directly', async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: 'p-7',
      name: 'Nutella',
      brand: 'Ferrero',
    });
    const results = await service.searchRegistry(' 301-7620422003 ');
    expect(results).toEqual([
      { productId: 'p-7', name: 'Nutella', brand: 'Ferrero', stage: 'barcode', confidence: 1 },
    ]);
  });

  it('getUserProductCandidates preserves recency order and caps the list', async () => {
    prismaMock.receiptItem.groupBy.mockResolvedValue([
      { productId: 'p-2', _max: { purchasedAt: new Date('2026-07-10') } },
      { productId: 'p-1', _max: { purchasedAt: new Date('2026-07-01') } },
    ]);
    prismaMock.product.findMany.mockResolvedValue(
      heads([
        { id: 'p-1', name: 'A' },
        { id: 'p-2', name: 'B' },
      ]),
    );
    const out = await service.getUserProductCandidates('u-1');
    expect(out.map((p) => p.id)).toEqual(['p-2', 'p-1']);
  });
});
