import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../realtime/event-bus.service';
import { BudgetService } from './budget.service';
import { BUDGET_ERRORS } from './constants/budget-errors';

describe('BudgetService', () => {
  let service: BudgetService;

  const prisma = {
    budget: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    groupMembership: { findUnique: jest.fn(), findMany: jest.fn() },
    category: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const eventBus = { publish: jest.fn() };

  const budgetRow = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    name: 'Groceries',
    amountCents: 80000,
    currency: 'ILS',
    scopeType: 'personal',
    ownerId: 'u1',
    groupId: null,
    categoryId: null,
    category: null,
    period: 'MONTHLY',
    startsAt: null,
    endsAt: null,
    alertThresholdPct: null,
    alertOverspend: true,
    archivedAt: null,
    createdById: 'u1',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  });

  const groupBudgetRow = (over: Record<string, unknown> = {}) =>
    budgetRow({ scopeType: 'group', ownerId: null, groupId: 'g1', ...over });

  /** Assert the promise rejects with a Nest exception carrying `errorCode`. */
  async function expectError(
    p: Promise<unknown>,
    cls: new (...args: never[]) => Error,
    errorCode: string,
  ): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(cls);
    await p.catch((e) => {
      expect((e.getResponse() as { errorCode?: string }).errorCode).toBe(errorCode);
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
    prisma.groupMembership.findMany.mockResolvedValue([]);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();
    service = mod.get(BudgetService);
  });

  describe('create — scope', () => {
    it('creates a personal budget owned by the caller, audits, publishes', async () => {
      prisma.budget.create.mockResolvedValue(budgetRow());

      const res = await service.create('u1', {
        name: 'Groceries',
        amountCents: 80000,
        currency: 'ILS',
        scopeType: 'personal',
        period: 'MONTHLY',
      });

      expect(prisma.budget.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scopeType: 'personal',
            ownerId: 'u1',
            groupId: null,
            createdById: 'u1',
          }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'BUDGET_CREATED', entity: 'Budget' }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith({
        type: 'budget.updated',
        userIds: ['u1'],
        budgetId: 'b1',
      });
      expect(res.id).toBe('b1');
      expect(res.scopeType).toBe('personal');
    });

    it('rejects personal scope carrying a groupId (BUDGET_INVALID_SCOPE)', async () => {
      await expectError(
        service.create('u1', {
          name: 'X',
          amountCents: 100,
          currency: 'ILS',
          scopeType: 'personal',
          groupId: 'g1',
          period: 'MONTHLY',
        }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_SCOPE,
      );
    });

    it('rejects group scope without groupId (BUDGET_INVALID_SCOPE)', async () => {
      await expectError(
        service.create('u1', {
          name: 'X',
          amountCents: 100,
          currency: 'ILS',
          scopeType: 'group',
          period: 'MONTHLY',
        }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_SCOPE,
      );
    });

    it('404s a non-member creating a group budget (no group-existence leak)', async () => {
      prisma.groupMembership.findUnique.mockResolvedValue(null);
      await expectError(
        service.create('u1', {
          name: 'X',
          amountCents: 100,
          currency: 'ILS',
          scopeType: 'group',
          groupId: 'g1',
          period: 'MONTHLY',
        }),
        NotFoundException,
        BUDGET_ERRORS.BUDGET_INVALID_SCOPE,
      );
    });

    it('403s a member (non-admin) creating a group budget (BUDGET_FORBIDDEN)', async () => {
      prisma.groupMembership.findUnique.mockResolvedValue({
        role: 'member',
        group: { defaultCurrency: 'USD' },
      });
      await expectError(
        service.create('u1', {
          name: 'X',
          amountCents: 100,
          currency: 'ILS',
          scopeType: 'group',
          groupId: 'g1',
          period: 'MONTHLY',
        }),
        ForbiddenException,
        BUDGET_ERRORS.BUDGET_FORBIDDEN,
      );
    });

    it('lets a group admin create; recipients = all group members', async () => {
      prisma.groupMembership.findUnique.mockResolvedValue({
        role: 'admin',
        group: { defaultCurrency: 'USD' },
      });
      prisma.groupMembership.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
      prisma.budget.create.mockResolvedValue(groupBudgetRow());

      await service.create('u1', {
        name: 'Team lunch',
        amountCents: 5000,
        currency: 'ILS',
        scopeType: 'group',
        groupId: 'g1',
        period: 'MONTHLY',
      });

      expect(eventBus.publish).toHaveBeenCalledWith({
        type: 'budget.updated',
        userIds: expect.arrayContaining(['u1', 'u2']),
        budgetId: 'b1',
      });
    });
  });

  describe('create — period', () => {
    const base = {
      name: 'X',
      amountCents: 100,
      currency: 'ILS' as const,
      scopeType: 'personal' as const,
    };

    it('rejects CUSTOM without bounds (BUDGET_INVALID_PERIOD)', async () => {
      await expectError(
        service.create('u1', { ...base, period: 'CUSTOM' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
      );
    });

    it('rejects CUSTOM with startsAt >= endsAt', async () => {
      await expectError(
        service.create('u1', {
          ...base,
          period: 'CUSTOM',
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-07-01T00:00:00.000Z',
        }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
      );
    });

    it('rejects a repeating period carrying bounds', async () => {
      await expectError(
        service.create('u1', { ...base, period: 'MONTHLY', startsAt: '2026-07-01' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
      );
    });

    it('accepts CUSTOM with valid bounds and persists them', async () => {
      prisma.budget.create.mockResolvedValue(
        budgetRow({
          period: 'CUSTOM',
          startsAt: new Date('2026-07-01T00:00:00.000Z'),
          endsAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      );
      const res = await service.create('u1', {
        ...base,
        period: 'CUSTOM',
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
      });
      expect(prisma.budget.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            startsAt: new Date('2026-07-01T00:00:00.000Z'),
            endsAt: new Date('2026-08-01T00:00:00.000Z'),
          }),
        }),
      );
      expect(res.period).toBe('CUSTOM');
    });
  });

  describe('create — category', () => {
    const base = {
      name: 'X',
      amountCents: 100,
      currency: 'ILS' as const,
      scopeType: 'personal' as const,
      period: 'MONTHLY' as const,
    };

    it('rejects a missing category (BUDGET_INVALID_CATEGORY)', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expectError(
        service.create('u1', { ...base, categoryId: '11111111-1111-1111-1111-111111111111' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_CATEGORY,
      );
    });

    it("rejects another user's personal category (wrong scope)", async () => {
      prisma.category.findUnique.mockResolvedValue({
        ownerType: 'user',
        ownerId: 'other-user',
        direction: 'OUT',
      });
      await expectError(
        service.create('u1', { ...base, categoryId: 'c1' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_CATEGORY,
      );
    });

    it('rejects a group category on a personal budget (wrong scope)', async () => {
      prisma.category.findUnique.mockResolvedValue({
        ownerType: 'group',
        ownerId: 'g1',
        direction: 'OUT',
      });
      await expectError(
        service.create('u1', { ...base, categoryId: 'c1' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_CATEGORY,
      );
    });

    it('rejects direction IN categories', async () => {
      prisma.category.findUnique.mockResolvedValue({
        ownerType: 'system',
        ownerId: null,
        direction: 'IN',
      });
      await expectError(
        service.create('u1', { ...base, categoryId: 'c1' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_CATEGORY,
      );
    });

    it('accepts a system OUT category', async () => {
      prisma.category.findUnique.mockResolvedValue({
        ownerType: 'system',
        ownerId: null,
        direction: 'OUT',
      });
      prisma.budget.create.mockResolvedValue(budgetRow({ categoryId: 'c1' }));
      const res = await service.create('u1', { ...base, categoryId: 'c1' });
      expect(res.categoryId).toBe('c1');
    });

    it("accepts the group's own category for a group budget", async () => {
      prisma.groupMembership.findUnique.mockResolvedValue({
        role: 'admin',
        group: { defaultCurrency: 'USD' },
      });
      prisma.category.findUnique.mockResolvedValue({
        ownerType: 'group',
        ownerId: 'g1',
        direction: 'BOTH',
      });
      prisma.budget.create.mockResolvedValue(groupBudgetRow({ categoryId: 'c1' }));
      const res = await service.create('u1', {
        ...base,
        scopeType: 'group',
        groupId: 'g1',
        categoryId: 'c1',
      });
      expect(res.categoryId).toBe('c1');
    });
  });

  describe('create — currency default', () => {
    it("defaults a personal budget to the owner's defaultCurrency", async () => {
      prisma.user.findUnique.mockResolvedValue({ defaultCurrency: 'EUR' });
      prisma.budget.create.mockResolvedValue(budgetRow({ currency: 'EUR' }));
      await service.create('u1', {
        name: 'X',
        amountCents: 100,
        scopeType: 'personal',
        period: 'MONTHLY',
      });
      expect(prisma.budget.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currency: 'EUR' }) }),
      );
    });

    it("defaults a group budget to the group's defaultCurrency", async () => {
      prisma.groupMembership.findUnique.mockResolvedValue({
        role: 'admin',
        group: { defaultCurrency: 'GBP' },
      });
      prisma.budget.create.mockResolvedValue(groupBudgetRow({ currency: 'GBP' }));
      await service.create('u1', {
        name: 'X',
        amountCents: 100,
        scopeType: 'group',
        groupId: 'g1',
        period: 'MONTHLY',
      });
      expect(prisma.budget.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currency: 'GBP' }) }),
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findById — read access', () => {
    it('returns a personal budget to its owner', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      const res = await service.findById('u1', 'b1');
      expect(res.id).toBe('b1');
    });

    it('404s an outsider on a personal budget (BUDGET_NOT_FOUND)', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      await expectError(
        service.findById('intruder', 'b1'),
        NotFoundException,
        BUDGET_ERRORS.BUDGET_NOT_FOUND,
      );
    });

    it('returns a group budget to any member (read-only role ok)', async () => {
      prisma.budget.findUnique.mockResolvedValue(groupBudgetRow());
      prisma.groupMembership.findUnique.mockResolvedValue({ role: 'member' });
      const res = await service.findById('u2', 'b1');
      expect(res.id).toBe('b1');
    });

    it('404s a non-member on a group budget', async () => {
      prisma.budget.findUnique.mockResolvedValue(groupBudgetRow());
      prisma.groupMembership.findUnique.mockResolvedValue(null);
      await expectError(
        service.findById('outsider', 'b1'),
        NotFoundException,
        BUDGET_ERRORS.BUDGET_NOT_FOUND,
      );
    });

    it('404s a missing budget', async () => {
      prisma.budget.findUnique.mockResolvedValue(null);
      await expectError(
        service.findById('u1', 'missing'),
        NotFoundException,
        BUDGET_ERRORS.BUDGET_NOT_FOUND,
      );
    });
  });

  describe('update', () => {
    it('lets the owner edit scalars; audits and publishes', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      prisma.budget.update.mockResolvedValue(budgetRow({ name: 'Food' }));

      const res = await service.update('u1', 'b1', { name: 'Food' });

      expect(prisma.budget.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b1' }, data: { name: 'Food' } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'BUDGET_UPDATED' }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'budget.updated', budgetId: 'b1' }),
      );
      expect(res.name).toBe('Food');
    });

    it('is a no-op for an empty patch (no update / audit / event)', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      const res = await service.update('u1', 'b1', {});
      expect(prisma.budget.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(res.id).toBe('b1');
    });

    it('409s edits on an archived budget (BUDGET_ARCHIVED)', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow({ archivedAt: new Date() }));
      await expectError(
        service.update('u1', 'b1', { name: 'Nope' }),
        ConflictException,
        BUDGET_ERRORS.BUDGET_ARCHIVED,
      );
    });

    it('403s a group member (non-admin) editing (BUDGET_FORBIDDEN)', async () => {
      prisma.budget.findUnique.mockResolvedValue(groupBudgetRow());
      prisma.groupMembership.findUnique.mockResolvedValue({ role: 'member' });
      await expectError(
        service.update('u2', 'b1', { name: 'Nope' }),
        ForbiddenException,
        BUDGET_ERRORS.BUDGET_FORBIDDEN,
      );
    });

    it('clears stale CUSTOM bounds when switching to a repeating period', async () => {
      prisma.budget.findUnique.mockResolvedValue(
        budgetRow({
          period: 'CUSTOM',
          startsAt: new Date('2026-07-01T00:00:00.000Z'),
          endsAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      );
      prisma.budget.update.mockResolvedValue(budgetRow({ period: 'MONTHLY' }));

      await service.update('u1', 'b1', { period: 'MONTHLY' });

      expect(prisma.budget.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ period: 'MONTHLY', startsAt: null, endsAt: null }),
        }),
      );
    });

    it('rejects explicit bounds together with a repeating period', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      await expectError(
        service.update('u1', 'b1', { period: 'WEEKLY', startsAt: '2026-07-01' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
      );
    });

    it('rejects switching to CUSTOM without bounds', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      await expectError(
        service.update('u1', 'b1', { period: 'CUSTOM' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
      );
    });

    it('clears the category with categoryId: null', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow({ categoryId: 'c1' }));
      prisma.budget.update.mockResolvedValue(budgetRow({ categoryId: null }));

      await service.update('u1', 'b1', { categoryId: null });

      expect(prisma.budget.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ categoryId: null }) }),
      );
      expect(prisma.category.findUnique).not.toHaveBeenCalled();
    });

    it("validates a replacement category against the budget's scope", async () => {
      prisma.budget.findUnique.mockResolvedValue(groupBudgetRow());
      prisma.groupMembership.findUnique.mockResolvedValue({ role: 'admin' });
      prisma.category.findUnique.mockResolvedValue({
        ownerType: 'user',
        ownerId: 'u1', // admin's own personal category — NOT valid for group scope
        direction: 'OUT',
      });
      await expectError(
        service.update('u1', 'b1', { categoryId: 'c-personal' }),
        BadRequestException,
        BUDGET_ERRORS.BUDGET_INVALID_CATEGORY,
      );
    });
  });

  describe('remove', () => {
    it('hard-deletes for the owner; audits and publishes', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      prisma.budget.delete.mockResolvedValue(budgetRow());

      await service.remove('u1', 'b1');

      expect(prisma.budget.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'BUDGET_DELETED' }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'budget.updated', budgetId: 'b1' }),
      );
    });

    it('still deletes an archived budget', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow({ archivedAt: new Date() }));
      prisma.budget.delete.mockResolvedValue(budgetRow());
      await expect(service.remove('u1', 'b1')).resolves.toBeUndefined();
    });

    it('403s a group member (non-admin) deleting', async () => {
      prisma.budget.findUnique.mockResolvedValue(groupBudgetRow());
      prisma.groupMembership.findUnique.mockResolvedValue({ role: 'member' });
      await expectError(
        service.remove('u2', 'b1'),
        ForbiddenException,
        BUDGET_ERRORS.BUDGET_FORBIDDEN,
      );
    });
  });

  describe('archive / unarchive', () => {
    it('archives an active budget; audits BUDGET_ARCHIVED', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      prisma.budget.update.mockResolvedValue(budgetRow({ archivedAt: new Date() }));

      const res = await service.archive('u1', 'b1');

      expect(prisma.budget.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { archivedAt: expect.any(Date) } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'BUDGET_ARCHIVED' }),
        }),
      );
      expect(res.archivedAt).not.toBeNull();
    });

    it('409s archiving an already-archived budget', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow({ archivedAt: new Date() }));
      await expectError(
        service.archive('u1', 'b1'),
        ConflictException,
        BUDGET_ERRORS.BUDGET_ARCHIVED,
      );
    });

    it('unarchives an archived budget; audits BUDGET_UNARCHIVED', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow({ archivedAt: new Date() }));
      prisma.budget.update.mockResolvedValue(budgetRow());

      const res = await service.unarchive('u1', 'b1');

      expect(prisma.budget.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { archivedAt: null } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'BUDGET_UNARCHIVED' }),
        }),
      );
      expect(res.archivedAt).toBeNull();
    });

    it('is idempotent — unarchiving an active budget is a no-op', async () => {
      prisma.budget.findUnique.mockResolvedValue(budgetRow());
      const res = await service.unarchive('u1', 'b1');
      expect(prisma.budget.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(res.archivedAt).toBeNull();
    });
  });

  describe('list', () => {
    it('excludes archived budgets by default', async () => {
      prisma.budget.findMany.mockResolvedValue([budgetRow()]);
      await service.list('u1', {});
      const where = prisma.budget.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ archivedAt: null }]));
    });

    it('includes archived budgets with includeArchived=true', async () => {
      prisma.budget.findMany.mockResolvedValue([budgetRow({ archivedAt: new Date() })]);
      await service.list('u1', { includeArchived: 'true' });
      const where = prisma.budget.findMany.mock.calls[0][0].where;
      expect(where.AND).not.toEqual(expect.arrayContaining([{ archivedAt: null }]));
    });

    it('narrows to personal scope', async () => {
      prisma.budget.findMany.mockResolvedValue([]);
      await service.list('u1', { scope: 'personal' });
      const where = prisma.budget.findMany.mock.calls[0][0].where;
      expect(where.AND[0]).toEqual({ scopeType: 'personal', ownerId: 'u1' });
    });

    it('403s a group scope the caller is not a member of', async () => {
      prisma.groupMembership.findUnique.mockResolvedValue(null);
      await expectError(
        service.list('u1', { scope: 'group:g1' }),
        ForbiddenException,
        BUDGET_ERRORS.BUDGET_FORBIDDEN,
      );
    });

    it('paginates with an opaque cursor (hasMore + nextCursor)', async () => {
      const rows = [
        budgetRow({ id: 'b3', createdAt: new Date('2026-07-03T00:00:00.000Z') }),
        budgetRow({ id: 'b2', createdAt: new Date('2026-07-02T00:00:00.000Z') }),
        budgetRow({ id: 'b1', createdAt: new Date('2026-07-01T00:00:00.000Z') }),
      ];
      prisma.budget.findMany.mockResolvedValue(rows);

      const page = await service.list('u1', { limit: 2 });

      expect(page.data).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toEqual(expect.any(String));
    });

    it('400s a malformed cursor', async () => {
      await expect(service.list('u1', { cursor: '!!not-base64!!' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
