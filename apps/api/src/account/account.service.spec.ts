import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../realtime/event-bus.service';
import { AccountService } from './account.service';
import { ACCOUNT_ERRORS } from './constants/account-errors';

describe('AccountService', () => {
  let service: AccountService;

  const prisma = {
    account: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    accountStatementLine: { groupBy: jest.fn() },
    transaction: { groupBy: jest.fn() },
    groupMembership: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const eventBus = { publish: jest.fn() };

  const anchor = new Date('2026-09-01T00:00:00.000Z');

  const accountRow = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    name: 'Checking',
    kind: 'BANK',
    institution: 'hapoalim',
    currency: 'ILS',
    last4: '4321',
    color: null,
    scopeType: 'personal',
    ownerId: 'u1',
    groupId: null,
    openingBalanceCents: 100_00,
    openingBalanceAt: anchor,
    reportedBalanceCents: null,
    reportedBalanceAt: null,
    billingAccountId: null,
    billingDay: null,
    archivedAt: null,
    createdById: 'u1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  });

  const groupAccountRow = (over: Record<string, unknown> = {}) =>
    accountRow({ scopeType: 'group', ownerId: null, groupId: 'g1', ...over });

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
    // No transactions and no statement lines unless a test says otherwise.
    prisma.transaction.groupBy.mockResolvedValue([]);
    prisma.accountStatementLine.groupBy.mockResolvedValue([]);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();
    service = mod.get(AccountService);
  });

  const createDto = (over: Record<string, unknown> = {}) =>
    ({
      name: 'Checking',
      kind: 'BANK',
      scopeType: 'personal',
      currency: 'ILS',
      ...over,
    }) as never;

  // ── create: scope ──

  describe('create — scope', () => {
    it('creates a personal account owned by the caller, audits, publishes', async () => {
      prisma.account.create.mockResolvedValue(accountRow());

      const res = await service.create('u1', createDto());

      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scopeType: 'personal', ownerId: 'u1', groupId: null }),
        }),
      );
      expect(res.id).toBe('a1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'ACCOUNT_CREATED', entity: 'Account' }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith({
        type: 'account.updated',
        userIds: ['u1'],
        accountId: 'a1',
      });
    });

    it('rejects a personal account carrying a groupId', async () => {
      await expectError(
        service.create('u1', createDto({ groupId: 'g1' })),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
      );
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('rejects a group account without a groupId', async () => {
      await expectError(
        service.create('u1', createDto({ scopeType: 'group' })),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
      );
    });

    it('404s a group the caller is not a member of (no existence probe)', async () => {
      prisma.groupMembership.findUnique.mockResolvedValue(null);
      await expectError(
        service.create('u1', createDto({ scopeType: 'group', groupId: 'g1' })),
        NotFoundException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
      );
    });

    it('403s a group member without the admin role', async () => {
      prisma.groupMembership.findUnique.mockResolvedValue({
        role: 'member',
        group: { defaultCurrency: 'EUR' },
      });
      await expectError(
        service.create('u1', createDto({ scopeType: 'group', groupId: 'g1' })),
        ForbiddenException,
        ACCOUNT_ERRORS.ACCOUNT_FORBIDDEN,
      );
    });

    it("defaults the currency to the owner's defaultCurrency", async () => {
      prisma.user.findUnique.mockResolvedValue({ defaultCurrency: 'ILS' });
      prisma.account.create.mockResolvedValue(accountRow());

      await service.create('u1', createDto({ currency: undefined }));

      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currency: 'ILS' }) }),
      );
    });

    it("defaults the currency to the group's defaultCurrency", async () => {
      prisma.groupMembership.findUnique.mockResolvedValue({
        role: 'admin',
        group: { defaultCurrency: 'EUR' },
      });
      prisma.account.create.mockResolvedValue(groupAccountRow({ currency: 'EUR' }));

      await service.create(
        'u1',
        createDto({ scopeType: 'group', groupId: 'g1', currency: undefined }),
      );

      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currency: 'EUR' }) }),
      );
    });
  });

  // ── create: institution + billing ──

  describe('create — institution and billing', () => {
    it('rejects an institution that does not issue this kind', async () => {
      await expectError(
        service.create('u1', createDto({ kind: 'BANK', institution: 'isracard' })),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_INSTITUTION,
      );
    });

    it('accepts a card issuer on a CARD account', async () => {
      prisma.account.create.mockResolvedValue(
        accountRow({ kind: 'CARD', institution: 'isracard' }),
      );
      await expect(
        service.create('u1', createDto({ kind: 'CARD', institution: 'isracard' })),
      ).resolves.toMatchObject({ id: 'a1' });
    });

    it('rejects billing fields on a non-CARD account', async () => {
      await expectError(
        service.create('u1', createDto({ billingAccountId: 'bank-1' })),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_BILLING,
      );
    });

    it('rejects billingDay without billingAccountId', async () => {
      await expectError(
        service.create('u1', createDto({ kind: 'CARD', billingDay: 10 })),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_BILLING,
      );
    });

    it('rejects a billing account that is not visible', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      await expectError(
        service.create('u1', createDto({ kind: 'CARD', billingAccountId: 'bank-1' })),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_BILLING,
      );
    });

    it('rejects a billing account of the wrong kind, currency, scope or archived', async () => {
      const base = {
        kind: 'BANK',
        currency: 'ILS',
        archivedAt: null,
        scopeType: 'personal',
        ownerId: 'u1',
        groupId: null,
      };
      const variants = [
        { ...base, kind: 'CARD' },
        { ...base, currency: 'USD' },
        { ...base, archivedAt: new Date() },
        { ...base, ownerId: 'someone-else' },
        { ...base, scopeType: 'group', ownerId: null, groupId: 'g1' },
      ];
      for (const variant of variants) {
        prisma.account.findFirst.mockResolvedValueOnce(variant);
        await expectError(
          service.create('u1', createDto({ kind: 'CARD', billingAccountId: 'bank-1' })),
          BadRequestException,
          ACCOUNT_ERRORS.ACCOUNT_INVALID_BILLING,
        );
      }
    });

    it('accepts a visible, active BANK account in the same scope and currency', async () => {
      prisma.account.findFirst.mockResolvedValue({
        kind: 'BANK',
        currency: 'ILS',
        archivedAt: null,
        scopeType: 'personal',
        ownerId: 'u1',
        groupId: null,
      });
      prisma.account.create.mockResolvedValue(
        accountRow({ kind: 'CARD', billingAccountId: 'bank-1', billingDay: 10 }),
      );

      const res = await service.create(
        'u1',
        createDto({ kind: 'CARD', billingAccountId: 'bank-1', billingDay: 10 }),
      );
      expect(res.billingAccountId).toBe('bank-1');
      expect(res.billingDay).toBe(10);
    });
  });

  // ── derived figures ──

  describe('ledger balance', () => {
    it('is opening + IN − OUT + incoming transfers, over two aggregate queries', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow());
      prisma.transaction.groupBy
        .mockResolvedValueOnce([
          { accountId: 'a1', direction: 'IN', _sum: { amountCents: 50_00 } },
          { accountId: 'a1', direction: 'OUT', _sum: { amountCents: 30_00 } },
        ])
        .mockResolvedValueOnce([{ transferAccountId: 'a1', _sum: { amountCents: 20_00 } }]);

      const res = await service.findById('u1', 'a1');

      expect(res.ledgerBalanceCents).toBe(100_00 + 50_00 - 30_00 + 20_00);
      expect(prisma.transaction.groupBy).toHaveBeenCalledTimes(2);
      // Countable rule: POSTED + ONE_TIME, from the anchor onwards.
      expect(prisma.transaction.groupBy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          by: ['accountId', 'direction'],
          where: expect.objectContaining({
            status: 'POSTED',
            type: 'ONE_TIME',
            OR: [{ accountId: 'a1', occurredAt: { gte: anchor } }],
          }),
        }),
      );
      expect(prisma.transaction.groupBy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ by: ['transferAccountId'] }),
      );
    });

    it('handles a negative opening balance (a card that owes money)', async () => {
      prisma.account.findFirst.mockResolvedValue(
        accountRow({ kind: 'CARD', openingBalanceCents: -250_00 }),
      );
      prisma.transaction.groupBy
        .mockResolvedValueOnce([
          { accountId: 'a1', direction: 'OUT', _sum: { amountCents: 50_00 } },
        ])
        .mockResolvedValueOnce([]);

      const res = await service.findById('u1', 'a1');
      expect(res.ledgerBalanceCents).toBe(-300_00);
    });

    it('reports no reconciliation gap when the bank figure is absent', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow());
      const res = await service.findById('u1', 'a1');
      expect(res.reconciliationGapCents).toBeNull();
      // Only the two ledger aggregates — no gap window to measure.
      expect(prisma.transaction.groupBy).toHaveBeenCalledTimes(2);
    });

    it('measures the gap as of reportedBalanceAt', async () => {
      const reportedAt = new Date('2026-09-20T00:00:00.000Z');
      prisma.account.findFirst.mockResolvedValue(
        accountRow({ reportedBalanceCents: 140_00, reportedBalanceAt: reportedAt }),
      );
      prisma.transaction.groupBy
        // ledger, no upper bound
        .mockResolvedValueOnce([{ accountId: 'a1', direction: 'IN', _sum: { amountCents: 60_00 } }])
        .mockResolvedValueOnce([])
        // gap window, bounded by reportedBalanceAt
        .mockResolvedValueOnce([{ accountId: 'a1', direction: 'IN', _sum: { amountCents: 30_00 } }])
        .mockResolvedValueOnce([]);

      const res = await service.findById('u1', 'a1');

      expect(res.ledgerBalanceCents).toBe(160_00);
      expect(res.reconciliationGapCents).toBe(140_00 - 130_00);
      expect(prisma.transaction.groupBy).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ accountId: 'a1', occurredAt: { gte: anchor, lt: reportedAt } }],
          }),
        }),
      );
    });

    it('counts pending statement lines from the table (0 when none)', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow());
      prisma.accountStatementLine.groupBy.mockResolvedValue([
        { accountId: 'a1', _count: { _all: 3 } },
      ]);
      const res = await service.findById('u1', 'a1');
      expect(res.pendingLinesCount).toBe(3);
    });
  });

  // ── list ──

  describe('list', () => {
    it('aggregates the whole page with a fixed number of queries', async () => {
      prisma.account.findMany.mockResolvedValue([
        accountRow({ id: 'a1' }),
        accountRow({ id: 'a2', openingBalanceCents: 0 }),
      ]);
      prisma.transaction.groupBy
        .mockResolvedValueOnce([{ accountId: 'a2', direction: 'IN', _sum: { amountCents: 7_00 } }])
        .mockResolvedValueOnce([]);

      const res = await service.list('u1', {} as never);

      expect(res.data.map((a) => a.ledgerBalanceCents)).toEqual([100_00, 7_00]);
      expect(res.hasMore).toBe(false);
      expect(prisma.transaction.groupBy).toHaveBeenCalledTimes(2);
      expect(prisma.accountStatementLine.groupBy).toHaveBeenCalledTimes(1);
    });

    it('hides archived accounts unless includeArchived=true', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      await service.list('u1', {} as never);
      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [expect.anything(), { archivedAt: null }] },
        }),
      );

      prisma.account.findMany.mockClear();
      await service.list('u1', { includeArchived: 'true' } as never);
      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [expect.anything()] } }),
      );
    });

    it('403s a group scope the caller is not a member of', async () => {
      prisma.groupMembership.findUnique.mockResolvedValue(null);
      await expectError(
        service.list('u1', { scope: 'group:g1' } as never),
        ForbiddenException,
        ACCOUNT_ERRORS.ACCOUNT_FORBIDDEN,
      );
    });

    it('emits a cursor only when there is another page', async () => {
      prisma.account.findMany.mockResolvedValue([
        accountRow({ id: 'a1' }),
        accountRow({ id: 'a2' }),
      ]);
      const res = await service.list('u1', { limit: 1 } as never);
      expect(res.hasMore).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.nextCursor).toEqual(expect.any(String));
    });
  });

  // ── access matrix ──

  describe('access', () => {
    it('404s a missing or invisible account on read', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      await expectError(
        service.findById('outsider', 'a1'),
        NotFoundException,
        ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND,
      );
    });

    it('403s a group member (non-admin) on a mutation', async () => {
      prisma.account.findFirst.mockResolvedValue(groupAccountRow());
      prisma.groupMembership.findUnique.mockResolvedValue({ role: 'member' });
      await expectError(
        service.update('u2', 'a1', { name: 'Hijack' }),
        ForbiddenException,
        ACCOUNT_ERRORS.ACCOUNT_FORBIDDEN,
      );
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('lets a group admin mutate', async () => {
      prisma.account.findFirst.mockResolvedValue(groupAccountRow());
      prisma.groupMembership.findUnique.mockResolvedValue({ role: 'admin' });
      prisma.account.update.mockResolvedValue(groupAccountRow({ name: 'Team card' }));
      const res = await service.update('u2', 'a1', { name: 'Team card' });
      expect(res.name).toBe('Team card');
    });
  });

  // ── update ──

  describe('update', () => {
    it('rejects a change of scope, group or currency', async () => {
      for (const dto of [{ scopeType: 'group' as const }, { groupId: 'g2' }, { currency: 'USD' }]) {
        prisma.account.findFirst.mockResolvedValue(accountRow());
        await expectError(
          service.update('u1', 'a1', dto),
          BadRequestException,
          ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
        );
      }
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('treats echoing the current scope and currency as a no-op', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow());
      const res = await service.update('u1', 'a1', {
        scopeType: 'personal',
        currency: 'ILS',
      });
      expect(prisma.account.update).not.toHaveBeenCalled();
      expect(res.id).toBe('a1');
    });

    it('rejects every mutation on an archived account', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow({ archivedAt: new Date() }));
      await expectError(
        service.update('u1', 'a1', { name: 'Nope' }),
        ConflictException,
        ACCOUNT_ERRORS.ACCOUNT_ARCHIVED,
      );

      prisma.account.findFirst.mockResolvedValue(accountRow({ archivedAt: new Date() }));
      await expectError(
        service.archive('u1', 'a1'),
        ConflictException,
        ACCOUNT_ERRORS.ACCOUNT_ARCHIVED,
      );
    });

    it('clears an inherited billingDay when the billing account is cleared', async () => {
      prisma.account.findFirst.mockResolvedValue(
        accountRow({ kind: 'CARD', billingAccountId: 'bank-1', billingDay: 10 }),
      );
      prisma.account.update.mockResolvedValue(accountRow({ kind: 'CARD' }));

      await service.update('u1', 'a1', { billingAccountId: null });

      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ billingAccountId: null, billingDay: null }),
        }),
      );
    });

    it('rejects a billingDay sent together with a cleared billing account', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow({ kind: 'CARD' }));
      await expectError(
        service.update('u1', 'a1', { billingAccountId: null, billingDay: 10 }),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_BILLING,
      );
    });

    it('rejects a card billing itself', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow({ kind: 'CARD' }));
      await expectError(
        service.update('u1', 'a1', { billingAccountId: 'a1' }),
        BadRequestException,
        ACCOUNT_ERRORS.ACCOUNT_INVALID_BILLING,
      );
    });
  });

  // ── archive / unarchive / delete ──

  describe('lifecycle', () => {
    it('archives, audits and publishes', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow());
      prisma.account.update.mockResolvedValue(accountRow({ archivedAt: new Date() }));

      const res = await service.archive('u1', 'a1');

      expect(res.archivedAt).not.toBeNull();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ACCOUNT_ARCHIVED' }) }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'account.updated', accountId: 'a1' }),
      );
    });

    it('unarchive on an active account is a silent no-op', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow());
      await service.unarchive('u1', 'a1');
      expect(prisma.account.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('deletes an archived account and audits it', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow({ archivedAt: new Date() }));
      prisma.account.delete.mockResolvedValue(accountRow());

      await service.remove('u1', 'a1');

      expect(prisma.account.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ACCOUNT_DELETED' }) }),
      );
    });

    it('never lets a failed audit write break the mutation', async () => {
      prisma.account.findFirst.mockResolvedValue(accountRow());
      prisma.account.update.mockResolvedValue(accountRow({ name: 'Renamed' }));
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));

      await expect(service.update('u1', 'a1', { name: 'Renamed' })).resolves.toMatchObject({
        name: 'Renamed',
      });
    });
  });

  // ── realtime recipients ──

  it('fans a group account event out to every member plus the actor', async () => {
    prisma.groupMembership.findUnique.mockResolvedValue({
      role: 'admin',
      group: { defaultCurrency: 'EUR' },
    });
    prisma.groupMembership.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    prisma.account.create.mockResolvedValue(groupAccountRow());

    await service.create('u1', createDto({ scopeType: 'group', groupId: 'g1' }));

    const event = eventBus.publish.mock.calls.at(-1)![0] as { userIds: string[] };
    expect(event.userIds.sort()).toEqual(['u1', 'u2']);
  });
});
