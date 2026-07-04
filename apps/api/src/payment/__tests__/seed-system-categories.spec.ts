import { DEFAULT_CATEGORIES } from '@myfinpro/shared';
import { seedSystemCategories } from '../seed-system-categories';

type MockPrisma = {
  category: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

const makeMockPrisma = (): MockPrisma => ({
  category: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
});

describe('seedSystemCategories', () => {
  it('creates all defaults when DB is empty', async () => {
    const mock = makeMockPrisma();
    mock.category.findFirst.mockResolvedValue(null);
    mock.category.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: `id-${data.slug as string}-${data.direction as string}`,
        ...data,
      }),
    );

    const result = await seedSystemCategories(mock as never);

    expect(mock.category.create).toHaveBeenCalledTimes(DEFAULT_CATEGORIES.length);
    expect(mock.category.update).not.toHaveBeenCalled();
    expect(result.size).toBe(DEFAULT_CATEGORIES.length);

    // Every definition should have a generated id in the result map.
    for (const def of DEFAULT_CATEGORIES) {
      expect(result.get(`${def.direction}:${def.slug}`)).toBe(`id-${def.slug}-${def.direction}`);
    }
  });

  it('is idempotent: updates existing rows rather than creating duplicates', async () => {
    const mock = makeMockPrisma();
    mock.category.findFirst.mockImplementation(
      async ({ where }: { where: { slug: string; direction: string } }) => ({
        id: `existing-${where.slug}-${where.direction}`,
        ...where,
      }),
    );
    mock.category.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        ...data,
      }),
    );

    const result = await seedSystemCategories(mock as never);

    expect(mock.category.create).not.toHaveBeenCalled();
    expect(mock.category.update).toHaveBeenCalledTimes(DEFAULT_CATEGORIES.length);
    expect(result.size).toBe(DEFAULT_CATEGORIES.length);
  });

  it('sets is_system=true and owner_type=system with owner_id=null on create', async () => {
    const mock = makeMockPrisma();
    mock.category.findFirst.mockResolvedValue(null);
    mock.category.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'x',
        ...data,
      }),
    );

    await seedSystemCategories(mock as never);

    for (const call of mock.category.create.mock.calls) {
      expect(call[0].data.isSystem).toBe(true);
      expect(call[0].data.ownerType).toBe('system');
      expect(call[0].data.ownerId).toBe(null);
    }
  });

  it('refreshes display fields (name/icon/color) on update', async () => {
    const mock = makeMockPrisma();
    mock.category.findFirst.mockResolvedValue({ id: 'existing-id' });
    mock.category.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        ...data,
      }),
    );

    await seedSystemCategories(mock as never);

    // First call should patch the first default's display fields.
    const firstDef = DEFAULT_CATEGORIES[0];
    expect(mock.category.update).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: {
        name: firstDef.name,
        icon: firstDef.icon ?? null,
        color: firstDef.color ?? null,
        isSystem: true,
      },
    });
  });

  it('seeds the expected 22 defaults (15 OUT + 7 IN)', async () => {
    const outCount = DEFAULT_CATEGORIES.filter((c) => c.direction === 'OUT').length;
    const inCount = DEFAULT_CATEGORIES.filter((c) => c.direction === 'IN').length;

    expect(outCount).toBe(15);
    expect(inCount).toBe(7);
    expect(DEFAULT_CATEGORIES.length).toBe(22);
  });
});
