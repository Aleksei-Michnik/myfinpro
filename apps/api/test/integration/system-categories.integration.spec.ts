import {
  DEFAULT_BOTH_CATEGORIES,
  DEFAULT_CATEGORIES,
  DEFAULT_IN_CATEGORIES,
  DEFAULT_OUT_CATEGORIES,
} from '@myfinpro/shared';
import { PrismaClient } from '@prisma/client';
import { StartedMySqlContainer } from '@testcontainers/mysql';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
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

  it('seeds one row per default, in every direction', async () => {
    await seedSystemCategories(prisma);

    const countFor = (direction: string) =>
      prisma.category.count({ where: { ownerType: 'system', ownerId: null, direction } });

    expect(await countFor('OUT')).toBe(DEFAULT_OUT_CATEGORIES.length);
    expect(await countFor('IN')).toBe(DEFAULT_IN_CATEGORIES.length);
    // Phase 20 — `transfer` is the first BOTH default; the column had to be
    // widened to VarChar(4) to hold the value at all.
    expect(await countFor('BOTH')).toBe(DEFAULT_BOTH_CATEGORIES.length);
    expect(DEFAULT_BOTH_CATEGORIES.map((c) => c.slug)).toContain('transfer');
  });

  it('marks every seeded row as is_system=true', async () => {
    await seedSystemCategories(prisma);

    const nonSystem = await prisma.category.count({
      where: { ownerType: 'system', ownerId: null, isSystem: false },
    });
    expect(nonSystem).toBe(0);
  });
});
