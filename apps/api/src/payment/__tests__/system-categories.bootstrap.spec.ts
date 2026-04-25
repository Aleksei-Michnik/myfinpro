import { SystemCategoriesBootstrap } from '../system-categories.bootstrap';

describe('SystemCategoriesBootstrap', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('skips seeding in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const prisma = {
      category: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const boot = new SystemCategoriesBootstrap(prisma as never);

    await boot.onModuleInit();

    expect(prisma.category.findFirst).not.toHaveBeenCalled();
    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('runs seeding in non-test environment', async () => {
    process.env.NODE_ENV = 'production';
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'x',
        ...data,
      }));
    const prisma = { category: { findFirst, create, update: jest.fn() } };
    const boot = new SystemCategoriesBootstrap(prisma as never);

    await boot.onModuleInit();

    expect(findFirst).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('runs seeding when NODE_ENV is unset', async () => {
    delete process.env.NODE_ENV;
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'x',
        ...data,
      }));
    const prisma = { category: { findFirst, create, update: jest.fn() } };
    const boot = new SystemCategoriesBootstrap(prisma as never);

    await boot.onModuleInit();

    expect(findFirst).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('swallows errors to avoid breaking boot', async () => {
    process.env.NODE_ENV = 'production';
    const prisma = {
      category: {
        findFirst: jest.fn().mockRejectedValue(new Error('db down')),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const boot = new SystemCategoriesBootstrap(prisma as never);

    await expect(boot.onModuleInit()).resolves.toBeUndefined();
  });
});
