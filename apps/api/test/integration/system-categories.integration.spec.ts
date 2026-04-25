import { DEFAULT_CATEGORIES } from '@myfinpro/shared';
import { PrismaClient } from '@prisma/client';
import { StartedMySqlContainer } from '@testcontainers/mysql';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/testcontainers';

describe('seedSystemCategories integration', () => {
  let prisma: PrismaClient;
  let container: StartedMySqlContainer;

  beforeAll(async () => {
    const ctx = await setupTestDatabase();
    prisma = ctx.prisma;
    container = ctx.container;
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(prisma, container);
  });

  beforeEach(async () => {
    // Start each test from a clean slate for system categories.
    await prisma.category.deleteMany({ where: { ownerType: 'system' } });
  });

  it('seeds all defaults exactly once on a fresh DB', async () => {
    const result = await seedSystemCategories(prisma);

    expect(result.size).toBe(DEFAULT_CATEGORIES.length);

    const count = await prisma.category.count({
      where: { ownerType: 'system', ownerId: null },
    });
    expect(count).toBe(DEFAULT_CATEGORIES.length);
  });

  it('is idempotent: second run does not create duplicates', async () => {
    await seedSystemCategories(prisma);
    await seedSystemCategories(prisma);

    const count = await prisma.category.count({
      where: { ownerType: 'system', ownerId: null },
    });
    expect(count).toBe(DEFAULT_CATEGORIES.length);
  });

  it('refreshes name when a default is mutated between runs', async () => {
    await seedSystemCategories(prisma);

    await prisma.category.updateMany({
      where: { slug: 'groceries', direction: 'OUT', ownerType: 'system' },
      data: { name: 'ZZZ_outdated_name' },
    });

    await seedSystemCategories(prisma);

    const row = await prisma.category.findFirst({
      where: { slug: 'groceries', direction: 'OUT', ownerType: 'system' },
    });
    expect(row?.name).toBe('Groceries');
  });

  it('seeds 15 OUT + 7 IN system categories', async () => {
    await seedSystemCategories(prisma);

    const outCount = await prisma.category.count({
      where: { ownerType: 'system', ownerId: null, direction: 'OUT' },
    });
    const inCount = await prisma.category.count({
      where: { ownerType: 'system', ownerId: null, direction: 'IN' },
    });

    expect(outCount).toBe(15);
    expect(inCount).toBe(7);
  });

  it('marks every seeded row as is_system=true', async () => {
    await seedSystemCategories(prisma);

    const nonSystem = await prisma.category.count({
      where: { ownerType: 'system', ownerId: null, isSystem: false },
    });
    expect(nonSystem).toBe(0);
  });
});
