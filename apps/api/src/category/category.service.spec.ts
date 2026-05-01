import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryService } from './category.service';
import { CATEGORY_ERRORS } from './constants/category-errors';

type ErrorResponse = { errorCode?: string };

function codeOf(err: unknown): string | undefined {
  const r = (err as { getResponse?: () => ErrorResponse }).getResponse?.();
  return r?.errorCode;
}

describe('CategoryService', () => {
  let service: CategoryService;

  const prismaMock = {
    category: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    groupMembership: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    payment: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };

  const now = new Date('2026-05-01T00:00:00Z');

  const makeCat = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'cat-1',
    slug: 'coffee',
    name: 'Coffee',
    icon: null,
    color: null,
    direction: 'OUT',
    ownerType: 'user',
    ownerId: 'user-1',
    isSystem: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  });

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [CategoryService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(CategoryService);
    jest.clearAllMocks();
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  // ── list() ──

  describe('list()', () => {
    it('returns system + user + member-group categories for scope=all', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1', role: 'member' }]);
      prismaMock.category.findMany.mockResolvedValue([makeCat({ ownerType: 'system' })]);

      const result = await service.list('user-1', {});

      expect(result).toHaveLength(1);
      const where = prismaMock.category.findMany.mock.calls[0][0].where as {
        OR: Array<Record<string, unknown>>;
      };
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { ownerType: 'system' },
          { ownerType: 'user', ownerId: 'user-1' },
          { ownerType: 'group', ownerId: { in: ['g1'] } },
        ]),
      );
    });

    it('filters by direction (IN or BOTH) when provided', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.category.findMany.mockResolvedValue([]);

      await service.list('user-1', { direction: 'IN' });

      const where = prismaMock.category.findMany.mock.calls[0][0].where as {
        direction: { in: string[] };
      };
      expect(where.direction).toEqual({ in: ['IN', 'BOTH'] });
    });

    it('scope=system filters correctly', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.category.findMany.mockResolvedValue([]);

      await service.list('user-1', { scope: 'system' });

      const where = prismaMock.category.findMany.mock.calls[0][0].where as {
        OR: Array<Record<string, unknown>>;
      };
      expect(where.OR).toEqual([{ ownerType: 'system' }]);
    });

    it('scope=personal restricts to own user categories', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.category.findMany.mockResolvedValue([]);

      await service.list('user-1', { scope: 'personal' });

      const where = prismaMock.category.findMany.mock.calls[0][0].where as {
        OR: Array<Record<string, unknown>>;
      };
      expect(where.OR).toEqual([{ ownerType: 'user', ownerId: 'user-1' }]);
    });

    it('scope=group:<id> as member returns that group only', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1', role: 'member' }]);
      prismaMock.category.findMany.mockResolvedValue([]);

      await service.list('user-1', { scope: 'group:g1' });

      const where = prismaMock.category.findMany.mock.calls[0][0].where as {
        OR: Array<Record<string, unknown>>;
      };
      expect(where.OR).toEqual([{ ownerType: 'group', ownerId: 'g1' }]);
    });

    it('scope=group:<id> as non-member throws CATEGORY_GROUP_NOT_MEMBER (403)', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([]);

      await expect(service.list('user-1', { scope: 'group:g1' })).rejects.toThrow(
        ForbiddenException,
      );
      try {
        await service.list('user-1', { scope: 'group:g1' });
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_GROUP_NOT_MEMBER);
      }
    });
  });

  // ── findById() ──

  describe('findById()', () => {
    it('returns a system category to any user', async () => {
      prismaMock.category.findUnique.mockResolvedValue(
        makeCat({ ownerType: 'system', ownerId: null }),
      );
      const r = await service.findById('user-1', 'cat-1');
      expect(r.id).toBe('cat-1');
    });

    it('throws 404 when category is not visible to the user', async () => {
      prismaMock.category.findUnique.mockResolvedValue(
        makeCat({ ownerType: 'user', ownerId: 'other' }),
      );
      await expect(service.findById('user-1', 'cat-1')).rejects.toThrow(NotFoundException);
    });

    it("throws 404 when category doesn't exist", async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);
      await expect(service.findById('user-1', 'cat-missing')).rejects.toThrow(NotFoundException);
    });

    it('returns a group-owned category if user is a member', async () => {
      prismaMock.category.findUnique.mockResolvedValue(
        makeCat({ ownerType: 'group', ownerId: 'g1' }),
      );
      prismaMock.groupMembership.findUnique.mockResolvedValue({ role: 'member' });
      const r = await service.findById('user-1', 'cat-1');
      expect(r.id).toBe('cat-1');
    });
  });

  // ── create() ──

  describe('create()', () => {
    it('creates a personal category and auto-generates a slug', async () => {
      prismaMock.category.create.mockImplementation((args: { data: { slug: string } }) =>
        Promise.resolve(makeCat({ ...args.data })),
      );

      const r = await service.create('user-1', {
        name: 'Coffee Shops!',
        direction: 'OUT',
        scope: 'personal',
      });

      const args = prismaMock.category.create.mock.calls[0][0] as {
        data: { slug: string; ownerType: string; ownerId: string };
      };
      expect(args.data.slug).toBe('coffee_shops');
      expect(args.data.ownerType).toBe('user');
      expect(args.data.ownerId).toBe('user-1');
      expect(r.slug).toBe('coffee_shops');
      expect(prismaMock.auditLog.create).toHaveBeenCalled();
    });

    it('creates a group category when user is admin', async () => {
      prismaMock.groupMembership.findUnique.mockResolvedValue({ role: 'admin' });
      prismaMock.category.create.mockResolvedValue(makeCat({ ownerType: 'group', ownerId: 'g1' }));

      const r = await service.create('user-1', {
        name: 'Team Coffee',
        direction: 'OUT',
        scope: 'group',
        groupId: 'g1',
      });

      expect(r.ownerType).toBe('group');
    });

    it('rejects group create when user is not an admin (member only)', async () => {
      prismaMock.groupMembership.findUnique.mockResolvedValue({ role: 'member' });

      await expect(
        service.create('user-1', {
          name: 'x',
          direction: 'OUT',
          scope: 'group',
          groupId: 'g1',
        }),
      ).rejects.toThrow(ForbiddenException);

      try {
        await service.create('user-1', {
          name: 'x',
          direction: 'OUT',
          scope: 'group',
          groupId: 'g1',
        });
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_GROUP_NOT_ADMIN);
      }
    });

    it('rejects group create when user is not a member', async () => {
      prismaMock.groupMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          name: 'x',
          direction: 'OUT',
          scope: 'group',
          groupId: 'g1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('translates Prisma P2002 (unique) into CATEGORY_SLUG_CONFLICT (409)', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
      prismaMock.category.create.mockRejectedValue(err);

      await expect(
        service.create('user-1', {
          name: 'Coffee',
          slug: 'coffee',
          direction: 'OUT',
          scope: 'personal',
        }),
      ).rejects.toThrow(ConflictException);

      try {
        await service.create('user-1', {
          name: 'Coffee',
          slug: 'coffee',
          direction: 'OUT',
          scope: 'personal',
        });
      } catch (e) {
        expect(codeOf(e)).toBe(CATEGORY_ERRORS.CATEGORY_SLUG_CONFLICT);
      }
    });

    it('rejects group scope without groupId', async () => {
      await expect(
        service.create('user-1', {
          name: 'x',
          direction: 'OUT',
          scope: 'group',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── update() ──

  describe('update()', () => {
    it('updates name/icon/color for the user owner', async () => {
      prismaMock.category.findUnique.mockResolvedValue(makeCat());
      prismaMock.category.update.mockResolvedValue(makeCat({ name: 'New' }));

      const r = await service.update('user-1', 'cat-1', { name: 'New' });

      expect(prismaMock.category.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { name: 'New' },
      });
      expect(r.name).toBe('New');
    });

    it('allows a group admin to update a group-owned category', async () => {
      prismaMock.category.findUnique.mockResolvedValue(
        makeCat({ ownerType: 'group', ownerId: 'g1' }),
      );
      prismaMock.groupMembership.findUnique.mockResolvedValue({ role: 'admin' });
      prismaMock.category.update.mockResolvedValue(
        makeCat({ ownerType: 'group', ownerId: 'g1', icon: 'x' }),
      );

      const r = await service.update('user-1', 'cat-1', { icon: 'x' });
      expect(r.icon).toBe('x');
    });

    it('rejects a non-owner (user category)', async () => {
      prismaMock.category.findUnique.mockResolvedValue(
        makeCat({ ownerType: 'user', ownerId: 'other' }),
      );

      await expect(service.update('user-1', 'cat-1', { name: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
      try {
        await service.update('user-1', 'cat-1', { name: 'x' });
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_NOT_OWNER);
      }
    });

    it('rejects updates on system categories', async () => {
      prismaMock.category.findUnique.mockResolvedValue(
        makeCat({ ownerType: 'system', isSystem: true, ownerId: null }),
      );

      await expect(service.update('user-1', 'cat-1', { name: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
      try {
        await service.update('user-1', 'cat-1', { name: 'x' });
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_SYSTEM_IMMUTABLE);
      }
    });

    it('rejects direction change when category is in use', async () => {
      prismaMock.category.findUnique.mockResolvedValue(makeCat({ direction: 'OUT' }));
      prismaMock.payment.count.mockResolvedValue(3);

      await expect(service.update('user-1', 'cat-1', { direction: 'IN' })).rejects.toThrow(
        ConflictException,
      );
      try {
        await service.update('user-1', 'cat-1', { direction: 'IN' });
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_IN_USE);
      }
    });

    it('allows direction change when category is unused', async () => {
      prismaMock.category.findUnique.mockResolvedValue(makeCat({ direction: 'OUT' }));
      prismaMock.payment.count.mockResolvedValue(0);
      prismaMock.category.update.mockResolvedValue(makeCat({ direction: 'IN' }));

      const r = await service.update('user-1', 'cat-1', { direction: 'IN' });
      expect(r.direction).toBe('IN');
    });
  });

  // ── remove() ──

  describe('remove()', () => {
    it('deletes a category with no payments and reassigned=0', async () => {
      prismaMock.category.findUnique.mockResolvedValue(makeCat());
      prismaMock.payment.count.mockResolvedValue(0);
      prismaMock.category.delete.mockResolvedValue({});

      const r = await service.remove('user-1', 'cat-1', {});

      expect(r).toEqual({ deleted: true, reassigned: 0 });
    });

    it('throws CATEGORY_IN_USE (409) when payments exist without replacement', async () => {
      prismaMock.category.findUnique.mockResolvedValue(makeCat());
      prismaMock.payment.count.mockResolvedValue(5);

      await expect(service.remove('user-1', 'cat-1', {})).rejects.toThrow(ConflictException);
      try {
        await service.remove('user-1', 'cat-1', {});
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_IN_USE);
      }
    });

    it('reassigns payments and deletes when replacement is valid', async () => {
      const source = makeCat({ id: 'cat-1', direction: 'OUT' });
      const target = makeCat({ id: 'cat-2', direction: 'OUT' });

      prismaMock.category.findUnique
        .mockResolvedValueOnce(source) // initial lookup
        .mockResolvedValueOnce(target); // replacement lookup
      prismaMock.payment.count.mockResolvedValue(4);
      prismaMock.$transaction.mockImplementation(async (cb) => {
        const tx = {
          payment: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) },
          category: { delete: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const r = await service.remove('user-1', 'cat-1', { replaceWithCategoryId: 'cat-2' });

      expect(r).toEqual({ deleted: true, reassigned: 4 });
    });

    it('rejects replacement with incompatible direction', async () => {
      const source = makeCat({ id: 'cat-1', direction: 'OUT' });
      const target = makeCat({ id: 'cat-2', direction: 'IN' });

      prismaMock.category.findUnique.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
      prismaMock.payment.count.mockResolvedValue(2);

      await expect(
        service.remove('user-1', 'cat-1', { replaceWithCategoryId: 'cat-2' }),
      ).rejects.toThrow(ConflictException);

      try {
        await service.remove('user-1', 'cat-1', { replaceWithCategoryId: 'cat-2' });
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_REPLACEMENT_INVALID);
      }
    });

    it('accepts BOTH as a superset replacement direction', async () => {
      const source = makeCat({ id: 'cat-1', direction: 'OUT' });
      const target = makeCat({ id: 'cat-2', direction: 'BOTH' });

      prismaMock.category.findUnique.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
      prismaMock.payment.count.mockResolvedValue(1);
      prismaMock.$transaction.mockImplementation(async (cb) => {
        const tx = {
          payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          category: { delete: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const r = await service.remove('user-1', 'cat-1', { replaceWithCategoryId: 'cat-2' });
      expect(r.reassigned).toBe(1);
    });

    it('rejects deleting a system category', async () => {
      prismaMock.category.findUnique.mockResolvedValue(
        makeCat({ ownerType: 'system', isSystem: true, ownerId: null }),
      );

      await expect(service.remove('user-1', 'cat-1', {})).rejects.toThrow(ForbiddenException);
      try {
        await service.remove('user-1', 'cat-1', {});
      } catch (err) {
        expect(codeOf(err)).toBe(CATEGORY_ERRORS.CATEGORY_SYSTEM_IMMUTABLE);
      }
    });

    it('throws 404 when category does not exist', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);
      await expect(service.remove('user-1', 'missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  it('does not fail the main operation when audit log creation throws', async () => {
    prismaMock.category.create.mockResolvedValue(makeCat());
    prismaMock.auditLog.create.mockRejectedValue(new Error('audit down'));

    await expect(
      service.create('user-1', { name: 'x', direction: 'OUT', scope: 'personal' }),
    ).resolves.toBeDefined();
  });
});
