import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import {
  buildCursorFor,
  buildCursorGuard,
  buildOrderBy,
  decodeCursor,
  encodeCursor,
  isValidCursor,
  mapPaymentToSummary,
  PaymentService,
  PaymentWithRelations,
} from './payment.service';

type ErrorResponse = { errorCode?: string };

function codeOf(err: unknown): string | undefined {
  const r = (err as { getResponse?: () => ErrorResponse }).getResponse?.();
  return r?.errorCode;
}

describe('PaymentService', () => {
  let service: PaymentService;

  const prismaMock = {
    payment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    paymentAttribution: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(1),
    },
    groupMembership: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };

  const categoryServiceMock = {
    findById: jest.fn(),
  };

  const now = new Date('2026-05-01T00:00:00Z');

  /** Factory for the relation-loaded payment returned by prisma.payment.create(). */
  const makePersistedPayment = (
    over: Partial<PaymentWithRelations> = {},
  ): PaymentWithRelations => ({
    id: 'pay-1',
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1250,
    currency: 'USD',
    occurredAt: new Date('2026-04-25T00:00:00Z'),
    status: 'POSTED',
    note: null,
    parentPaymentId: null,
    createdById: 'user-1',
    createdAt: now,
    updatedAt: now,
    category: {
      id: 'cat-1',
      slug: 'groceries',
      name: 'Groceries',
      icon: null,
      color: null,
    },
    attributions: [{ scopeType: 'personal', userId: 'user-1', groupId: null, group: null }],
    ...over,
  });

  const baseDto = (over: Partial<CreatePaymentDto> = {}): CreatePaymentDto => ({
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1250,
    currency: 'USD',
    occurredAt: '2026-04-25',
    categoryId: 'cat-1',
    attributions: [{ scope: 'personal' }],
    ...over,
  });

  const okCategory = (over: Record<string, unknown> = {}) => ({
    id: 'cat-1',
    slug: 'groceries',
    name: 'Groceries',
    icon: null,
    color: null,
    direction: 'OUT' as const,
    ownerType: 'system' as const,
    ownerId: null,
    isSystem: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...over,
  });

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CategoryService, useValue: categoryServiceMock },
      ],
    }).compile();
    service = mod.get(PaymentService);
    jest.clearAllMocks();
    prismaMock.auditLog.create.mockResolvedValue({});
    // Default: $transaction runs the callback with a tx that points at the same mocks.
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        payment: prismaMock.payment,
        paymentAttribution: prismaMock.paymentAttribution,
      }),
    );
    // Remaining-count default: payment still has attributions after remove.
    prismaMock.paymentAttribution.count.mockResolvedValue(1);
  });

  // ── type guard ──

  describe('type guard', () => {
    it.each(['RECURRING', 'LIMITED_PERIOD', 'INSTALLMENT', 'LOAN', 'MORTGAGE'] as const)(
      'rejects type=%s with PAYMENT_TYPE_NOT_IMPLEMENTED',
      async (t) => {
        await expect(service.create('user-1', baseDto({ type: t }))).rejects.toThrow(
          BadRequestException,
        );
        try {
          await service.create('user-1', baseDto({ type: t }));
        } catch (err) {
          expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_TYPE_NOT_IMPLEMENTED);
        }
      },
    );
  });

  // ── schedule / plan guards ──

  describe('schedule/plan guards', () => {
    it('rejects when schedule body is present', async () => {
      await expect(
        service.create('user-1', baseDto({ schedule: { frequency: 'MONTHLY' } })),
      ).rejects.toThrow(BadRequestException);
      try {
        await service.create('user-1', baseDto({ schedule: { x: 1 } }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_SUPPORTED);
      }
    });

    it('rejects when plan body is present', async () => {
      try {
        await service.create('user-1', baseDto({ plan: { kind: 'INSTALLMENT' } }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_PLAN_NOT_SUPPORTED);
      }
    });
  });

  // ── amount ──

  describe('amount', () => {
    it('rejects amountCents = 0', async () => {
      try {
        await service.create('user-1', baseDto({ amountCents: 0 }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT);
      }
    });

    it('rejects negative amountCents', async () => {
      try {
        await service.create('user-1', baseDto({ amountCents: -5 }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT);
      }
    });

    it('rejects non-integer amountCents', async () => {
      try {
        await service.create('user-1', baseDto({ amountCents: 12.5 }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT);
      }
    });

    it('rejects amountCents above 1e11 cap', async () => {
      try {
        await service.create('user-1', baseDto({ amountCents: 1e11 + 1 }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT);
      }
    });
  });

  // ── currency ──

  describe('currency', () => {
    it('rejects an unknown currency code', async () => {
      try {
        await service.create('user-1', baseDto({ currency: 'ZZZ' }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_CURRENCY);
      }
    });
  });

  // ── date ──

  describe('date', () => {
    it('rejects occurredAt more than 1 day in the future', async () => {
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await service.create('user-1', baseDto({ occurredAt: future }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_DATE);
      }
    });

    it('accepts occurredAt within the 1-day grace window', async () => {
      categoryServiceMock.findById.mockResolvedValue(okCategory());
      prismaMock.payment.create.mockResolvedValue(makePersistedPayment());

      const within = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await expect(
        service.create('user-1', baseDto({ occurredAt: within })),
      ).resolves.toBeDefined();
    });
  });

  // ── category ──

  describe('category', () => {
    it('propagates failure from categoryService as PAYMENT_INVALID_CATEGORY', async () => {
      categoryServiceMock.findById.mockRejectedValue(new NotFoundException('gone'));
      try {
        await service.create('user-1', baseDto());
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_CATEGORY);
      }
    });

    it('rejects direction mismatch (OUT payment with IN category)', async () => {
      categoryServiceMock.findById.mockResolvedValue(okCategory({ direction: 'IN' }));
      try {
        await service.create('user-1', baseDto({ direction: 'OUT' }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_CATEGORY_DIRECTION_MISMATCH);
      }
    });

    it('accepts BOTH category for either payment direction', async () => {
      categoryServiceMock.findById.mockResolvedValue(okCategory({ direction: 'BOTH' }));
      prismaMock.payment.create.mockResolvedValue(makePersistedPayment({ direction: 'IN' }));

      await expect(service.create('user-1', baseDto({ direction: 'IN' }))).resolves.toBeDefined();
    });
  });

  // ── attributions ──

  describe('attributions', () => {
    beforeEach(() => {
      categoryServiceMock.findById.mockResolvedValue(okCategory());
    });

    it('rejects empty attributions', async () => {
      try {
        await service.create('user-1', baseDto({ attributions: [] }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NO_ATTRIBUTIONS);
      }
    });

    it('rejects personal + groupId (malformed)', async () => {
      try {
        await service.create(
          'user-1',
          baseDto({ attributions: [{ scope: 'personal', groupId: 'g1' }] }),
        );
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_ATTRIBUTION);
      }
    });

    it('rejects group without groupId (malformed)', async () => {
      try {
        await service.create('user-1', baseDto({ attributions: [{ scope: 'group' }] }));
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_ATTRIBUTION);
      }
    });

    it('rejects duplicate personal attributions', async () => {
      try {
        await service.create(
          'user-1',
          baseDto({ attributions: [{ scope: 'personal' }, { scope: 'personal' }] }),
        );
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_DUPLICATE_ATTRIBUTION);
      }
    });

    it('rejects duplicate group attributions on same groupId', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      try {
        await service.create(
          'user-1',
          baseDto({
            attributions: [
              { scope: 'group', groupId: 'g1' },
              { scope: 'group', groupId: 'g1' },
            ],
          }),
        );
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_DUPLICATE_ATTRIBUTION);
      }
    });

    it('rejects group attribution when user is not a member', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      try {
        await service.create(
          'user-1',
          baseDto({ attributions: [{ scope: 'group', groupId: 'g1' }] }),
        );
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_ATTRIBUTION_OUT_OF_SCOPE);
      }
    });
  });

  // ── happy paths ──

  describe('create() success', () => {
    beforeEach(() => {
      categoryServiceMock.findById.mockResolvedValue(okCategory());
    });

    it('creates a personal-only payment', async () => {
      prismaMock.payment.create.mockResolvedValue(makePersistedPayment());

      const r = await service.create('user-1', baseDto());

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.payment.create).toHaveBeenCalled();
      const arg = prismaMock.payment.create.mock.calls[0][0] as {
        data: {
          direction: string;
          type: string;
          status: string;
          createdById: string;
          attributions: { create: Array<{ scopeType: string; userId: string | null }> };
        };
      };
      expect(arg.data).toEqual(
        expect.objectContaining({
          direction: 'OUT',
          type: 'ONE_TIME',
          status: 'POSTED',
          createdById: 'user-1',
        }),
      );
      expect(arg.data.attributions.create).toEqual([
        { scopeType: 'personal', userId: 'user-1', groupId: null },
      ]);
      expect(r).toEqual(
        expect.objectContaining({
          id: 'pay-1',
          direction: 'OUT',
          type: 'ONE_TIME',
          amountCents: 1250,
          currency: 'USD',
          status: 'POSTED',
          starredByMe: false,
          commentCount: 0,
          hasDocuments: false,
        }),
      );
      expect(r.category).toEqual(
        expect.objectContaining({ id: 'cat-1', slug: 'groceries', name: 'Groceries' }),
      );
      expect(r.attributions).toHaveLength(1);
    });

    it('creates a group-only payment when the caller is a member', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.payment.create.mockResolvedValue(
        makePersistedPayment({
          attributions: [
            { scopeType: 'group', userId: null, groupId: 'g1', group: { name: 'Fam' } },
          ],
        }),
      );

      const r = await service.create(
        'user-1',
        baseDto({ attributions: [{ scope: 'group', groupId: 'g1' }] }),
      );

      const arg = prismaMock.payment.create.mock.calls[0][0] as {
        data: { attributions: { create: Array<{ scopeType: string; groupId: string | null }> } };
      };
      expect(arg.data.attributions.create).toEqual([
        { scopeType: 'group', userId: null, groupId: 'g1' },
      ]);
      expect(r.attributions[0]).toEqual(
        expect.objectContaining({ scope: 'group', groupId: 'g1', groupName: 'Fam' }),
      );
    });

    it('creates a mixed personal + group payment', async () => {
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.payment.create.mockResolvedValue(
        makePersistedPayment({
          attributions: [
            { scopeType: 'personal', userId: 'user-1', groupId: null, group: null },
            { scopeType: 'group', userId: null, groupId: 'g1', group: { name: 'Fam' } },
          ],
        }),
      );

      const r = await service.create(
        'user-1',
        baseDto({ attributions: [{ scope: 'personal' }, { scope: 'group', groupId: 'g1' }] }),
      );

      expect(r.attributions).toHaveLength(2);
    });

    it('writes a PAYMENT_CREATED audit log', async () => {
      prismaMock.payment.create.mockResolvedValue(makePersistedPayment());
      await service.create('user-1', baseDto());

      // Allow the fire-and-forget audit call to resolve.
      await new Promise((res) => setImmediate(res));
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PAYMENT_CREATED',
            entity: 'Payment',
            entityId: 'pay-1',
            userId: 'user-1',
          }),
        }),
      );
    });

    it('does not fail the main operation when audit log throws', async () => {
      prismaMock.payment.create.mockResolvedValue(makePersistedPayment());
      prismaMock.auditLog.create.mockRejectedValueOnce(new Error('audit down'));
      await expect(service.create('user-1', baseDto())).resolves.toBeDefined();
    });

    it('passes the note through to the payment record', async () => {
      prismaMock.payment.create.mockResolvedValue(makePersistedPayment({ note: 'lunch money' }));
      const r = await service.create('user-1', baseDto({ note: 'lunch money' }));
      expect(r.note).toBe('lunch money');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Iteration 6.6 — list()
    // ──────────────────────────────────────────────────────────────────────────

    describe('list()', () => {
      /** Build a row shaped like what Prisma returns with our include/_count. */
      const makeRow = (over: Record<string, unknown> = {}) => ({
        id: 'pay-1',
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: 1000,
        currency: 'USD',
        occurredAt: new Date('2026-04-25T00:00:00Z'),
        status: 'POSTED',
        note: null,
        parentPaymentId: null,
        createdById: 'user-1',
        createdAt: now,
        updatedAt: now,
        category: { id: 'cat-1', slug: 'groceries', name: 'Groceries', icon: null, color: null },
        attributions: [{ scopeType: 'personal', userId: 'user-1', groupId: null, group: null }],
        stars: [] as Array<{ id: string }>,
        _count: { comments: 0, documents: 0 },
        ...over,
      });

      const baseQ = (over: Partial<ListPaymentsQueryDto> = {}): ListPaymentsQueryDto =>
        ({ ...over }) as ListPaymentsQueryDto;

      const lastFindManyArg = () => {
        const calls = prismaMock.payment.findMany.mock.calls;
        return calls[calls.length - 1]?.[0] as {
          where: { AND: Array<Record<string, unknown>> };
          orderBy: unknown;
          take: number;
          include: Record<string, unknown>;
        };
      };

      beforeEach(() => {
        prismaMock.payment.findMany.mockResolvedValue([]);
      });

      // ── scope/visibility ──

      it('scope=all (default): builds OR of personal + member-group attributions', async () => {
        await service.list('user-1', baseQ());
        const { where } = lastFindManyArg();
        const attrClause = (where.AND[0] as { attributions: { some: { OR: unknown[] } } })
          .attributions.some;
        expect(attrClause.OR).toEqual([
          { scopeType: 'personal', userId: 'user-1' },
          {
            scopeType: 'group',
            group: { memberships: { some: { userId: 'user-1' } } },
          },
        ]);
      });

      it('scope=personal: narrows to personal attributions only', async () => {
        await service.list('user-1', baseQ({ scope: 'personal' }));
        const attrClause = (
          lastFindManyArg().where.AND[0] as {
            attributions: { some: Record<string, unknown> };
          }
        ).attributions.some;
        expect(attrClause).toEqual({ scopeType: 'personal', userId: 'user-1' });
      });

      it('scope=group:<id> as a member: narrows to that group', async () => {
        prismaMock.groupMembership.findUnique.mockResolvedValue({
          groupId: 'g1',
          userId: 'user-1',
        });
        await service.list('user-1', baseQ({ scope: 'group:g1' }));
        expect(prismaMock.groupMembership.findUnique).toHaveBeenCalledWith({
          where: { groupId_userId: { groupId: 'g1', userId: 'user-1' } },
        });
        const attrClause = (
          lastFindManyArg().where.AND[0] as {
            attributions: { some: Record<string, unknown> };
          }
        ).attributions.some;
        expect(attrClause).toEqual({ scopeType: 'group', groupId: 'g1' });
      });

      it('scope=group:<id> for a non-member: throws PAYMENT_SCOPE_NOT_ACCESSIBLE', async () => {
        prismaMock.groupMembership.findUnique.mockResolvedValue(null);
        await expect(service.list('user-1', baseQ({ scope: 'group:g1' }))).rejects.toThrow(
          ForbiddenException,
        );
        try {
          await service.list('user-1', baseQ({ scope: 'group:g1' }));
        } catch (err) {
          expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_SCOPE_NOT_ACCESSIBLE);
        }
      });

      // ── filters ──

      it('direction filter adds WHERE', async () => {
        await service.list('user-1', baseQ({ direction: 'IN' }));
        expect(lastFindManyArg().where.AND).toContainEqual({ direction: 'IN' });
      });

      it('categoryId filter adds WHERE', async () => {
        await service.list('user-1', baseQ({ categoryId: 'cat-1' }));
        expect(lastFindManyArg().where.AND).toContainEqual({ categoryId: 'cat-1' });
      });

      it('type filter adds WHERE', async () => {
        await service.list('user-1', baseQ({ type: 'ONE_TIME' }));
        expect(lastFindManyArg().where.AND).toContainEqual({ type: 'ONE_TIME' });
      });

      it('from + to compose a single occurredAt range', async () => {
        await service.list(
          'user-1',
          baseQ({ from: '2026-04-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }),
        );
        const found = lastFindManyArg().where.AND.find(
          (c) => (c as { occurredAt?: unknown }).occurredAt,
        ) as { occurredAt: { gte: Date; lt: Date } };
        expect(found.occurredAt.gte).toEqual(new Date('2026-04-01T00:00:00Z'));
        expect(found.occurredAt.lt).toEqual(new Date('2026-05-01T00:00:00Z'));
      });

      it('only from is set: adds gte without lt', async () => {
        await service.list('user-1', baseQ({ from: '2026-04-01T00:00:00Z' }));
        const found = lastFindManyArg().where.AND.find(
          (c) => (c as { occurredAt?: unknown }).occurredAt,
        ) as { occurredAt: { gte?: Date; lt?: Date } };
        expect(found.occurredAt.gte).toEqual(new Date('2026-04-01T00:00:00Z'));
        expect(found.occurredAt.lt).toBeUndefined();
      });

      it('search adds a case-insensitive contains on note', async () => {
        await service.list('user-1', baseQ({ search: 'lunch' }));
        expect(lastFindManyArg().where.AND).toContainEqual({ note: { contains: 'lunch' } });
      });

      it('starred=true adds stars.some', async () => {
        await service.list('user-1', baseQ({ starred: 'true' }));
        expect(lastFindManyArg().where.AND).toContainEqual({
          stars: { some: { userId: 'user-1' } },
        });
      });

      it('starred=false adds stars.none', async () => {
        await service.list('user-1', baseQ({ starred: 'false' }));
        expect(lastFindManyArg().where.AND).toContainEqual({
          stars: { none: { userId: 'user-1' } },
        });
      });

      it('starred unset: no stars filter', async () => {
        await service.list('user-1', baseQ());
        const andClauses = lastFindManyArg().where.AND;
        const starsClause = andClauses.find((c) => (c as { stars?: unknown }).stars);
        expect(starsClause).toBeUndefined();
      });

      // ── sort / orderBy ──

      it.each([
        ['date_desc' as const, [{ occurredAt: 'desc' }, { id: 'desc' }]],
        ['date_asc' as const, [{ occurredAt: 'asc' }, { id: 'asc' }]],
        ['amount_desc' as const, [{ amountCents: 'desc' }, { id: 'desc' }]],
        ['amount_asc' as const, [{ amountCents: 'asc' }, { id: 'asc' }]],
      ])('sort=%s maps to the expected orderBy', async (sort, expected) => {
        await service.list('user-1', baseQ({ sort }));
        expect(lastFindManyArg().orderBy).toEqual(expected);
      });

      it('default sort is date_desc when omitted', async () => {
        await service.list('user-1', baseQ());
        expect(lastFindManyArg().orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }]);
      });

      // ── limit & peek-one-more ──

      it('limit is clamped to 100 maximum', async () => {
        await service.list('user-1', baseQ({ limit: 500 }));
        expect(lastFindManyArg().take).toBe(101);
      });

      it('default limit is 20 → take 21', async () => {
        await service.list('user-1', baseQ());
        expect(lastFindManyArg().take).toBe(21);
      });

      it('hasMore=true when rows exceed limit; slice trims the peek row', async () => {
        const rows = [makeRow({ id: 'p1' }), makeRow({ id: 'p2' }), makeRow({ id: 'p3' })];
        prismaMock.payment.findMany.mockResolvedValue(rows);
        const r = await service.list('user-1', baseQ({ limit: 2 }));
        expect(r.hasMore).toBe(true);
        expect(r.data).toHaveLength(2);
        expect(r.data.map((d) => d.id)).toEqual(['p1', 'p2']);
        expect(r.nextCursor).not.toBeNull();
      });

      it('hasMore=false when rows equal limit exactly', async () => {
        prismaMock.payment.findMany.mockResolvedValue([
          makeRow({ id: 'p1' }),
          makeRow({ id: 'p2' }),
        ]);
        const r = await service.list('user-1', baseQ({ limit: 2 }));
        expect(r.hasMore).toBe(false);
        expect(r.nextCursor).toBeNull();
        expect(r.data).toHaveLength(2);
      });

      // ── cursor round-trip & guards ──

      it('cursor: malformed base64url returns 400 PAYMENT_INVALID_CURSOR', async () => {
        await expect(service.list('user-1', baseQ({ cursor: '!!not-valid!!' }))).rejects.toThrow(
          BadRequestException,
        );
        try {
          await service.list('user-1', baseQ({ cursor: '!!not-valid!!' }));
        } catch (err) {
          expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_CURSOR);
        }
      });

      it('cursor: wrong shape for sort returns 400 PAYMENT_INVALID_CURSOR', async () => {
        const badCursor = encodeCursor({ k: 'amount', amountCents: 100, id: 'p1' });
        try {
          await service.list('user-1', baseQ({ cursor: badCursor, sort: 'date_desc' }));
        } catch (err) {
          expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_CURSOR);
        }
      });

      it('cursor date_desc applies lt/eq-and-lt guard', async () => {
        const iso = '2026-04-25T00:00:00.000Z';
        const cursor = encodeCursor({ k: 'date', occurredAt: iso, id: 'p1' });
        await service.list('user-1', baseQ({ cursor, sort: 'date_desc' }));
        const guard = lastFindManyArg().where.AND.find((c) => (c as { OR?: unknown }).OR) as {
          OR: Array<Record<string, unknown>>;
        };
        expect(guard.OR).toEqual([
          { occurredAt: { lt: new Date(iso) } },
          { occurredAt: new Date(iso), id: { lt: 'p1' } },
        ]);
      });

      it('cursor date_asc applies gt/eq-and-gt guard', async () => {
        const iso = '2026-04-25T00:00:00.000Z';
        const cursor = encodeCursor({ k: 'date', occurredAt: iso, id: 'p1' });
        await service.list('user-1', baseQ({ cursor, sort: 'date_asc' }));
        const guard = lastFindManyArg().where.AND.find((c) => (c as { OR?: unknown }).OR) as {
          OR: Array<Record<string, unknown>>;
        };
        expect(guard.OR).toEqual([
          { occurredAt: { gt: new Date(iso) } },
          { occurredAt: new Date(iso), id: { gt: 'p1' } },
        ]);
      });

      it('cursor amount_desc applies lt/eq-and-lt on amountCents', async () => {
        const cursor = encodeCursor({ k: 'amount', amountCents: 1000, id: 'p1' });
        await service.list('user-1', baseQ({ cursor, sort: 'amount_desc' }));
        const guard = lastFindManyArg().where.AND.find((c) => (c as { OR?: unknown }).OR) as {
          OR: Array<Record<string, unknown>>;
        };
        expect(guard.OR).toEqual([
          { amountCents: { lt: 1000 } },
          { amountCents: 1000, id: { lt: 'p1' } },
        ]);
      });

      it('cursor amount_asc applies gt/eq-and-gt on amountCents', async () => {
        const cursor = encodeCursor({ k: 'amount', amountCents: 1000, id: 'p1' });
        await service.list('user-1', baseQ({ cursor, sort: 'amount_asc' }));
        const guard = lastFindManyArg().where.AND.find((c) => (c as { OR?: unknown }).OR) as {
          OR: Array<Record<string, unknown>>;
        };
        expect(guard.OR).toEqual([
          { amountCents: { gt: 1000 } },
          { amountCents: 1000, id: { gt: 'p1' } },
        ]);
      });

      it('nextCursor encodes date cursor for date_* sort', async () => {
        const rows = [makeRow({ id: 'p1' }), makeRow({ id: 'p2' }), makeRow({ id: 'p3' })];
        prismaMock.payment.findMany.mockResolvedValue(rows);
        const r = await service.list('user-1', baseQ({ limit: 2, sort: 'date_desc' }));
        const payload = decodeCursor(r.nextCursor!);
        expect(payload).toEqual({
          k: 'date',
          occurredAt: '2026-04-25T00:00:00.000Z',
          id: 'p2',
        });
      });

      it('nextCursor encodes amount cursor for amount_* sort', async () => {
        const rows = [
          makeRow({ id: 'p1', amountCents: 3000 }),
          makeRow({ id: 'p2', amountCents: 2000 }),
          makeRow({ id: 'p3', amountCents: 1000 }),
        ];
        prismaMock.payment.findMany.mockResolvedValue(rows);
        const r = await service.list('user-1', baseQ({ limit: 2, sort: 'amount_desc' }));
        const payload = decodeCursor(r.nextCursor!);
        expect(payload).toEqual({ k: 'amount', amountCents: 2000, id: 'p2' });
      });

      // ── mapping correctness ──

      it('maps starredByMe / commentCount / hasDocuments from includes', async () => {
        prismaMock.payment.findMany.mockResolvedValue([
          makeRow({
            id: 'p1',
            stars: [{ id: 's1' }],
            _count: { comments: 5, documents: 2 },
          }),
        ]);
        const r = await service.list('user-1', baseQ({ limit: 10 }));
        expect(r.data[0]).toEqual(
          expect.objectContaining({ starredByMe: true, commentCount: 5, hasDocuments: true }),
        );
      });

      it('starredByMe=false when stars include is empty', async () => {
        prismaMock.payment.findMany.mockResolvedValue([makeRow({ stars: [] })]);
        const r = await service.list('user-1', baseQ({ limit: 10 }));
        expect(r.data[0].starredByMe).toBe(false);
      });

      it('hasDocuments=false when _count.documents is 0', async () => {
        prismaMock.payment.findMany.mockResolvedValue([
          makeRow({ _count: { comments: 0, documents: 0 } }),
        ]);
        const r = await service.list('user-1', baseQ({ limit: 10 }));
        expect(r.data[0].hasDocuments).toBe(false);
      });

      it('include uses stars scoped to current user (no N+1)', async () => {
        await service.list('user-1', baseQ());
        const include = lastFindManyArg().include as {
          stars: { where: { userId: string } };
          _count: { select: { comments: boolean; documents: boolean } };
        };
        expect(include.stars.where).toEqual({ userId: 'user-1' });
        expect(include._count.select).toEqual({ comments: true, documents: true });
      });

      it('returns empty data + hasMore=false when no rows match', async () => {
        prismaMock.payment.findMany.mockResolvedValue([]);
        const r = await service.list('user-1', baseQ());
        expect(r).toEqual({ data: [], nextCursor: null, hasMore: false });
      });
    });

    // ── Cursor helper pure-function tests ──

    describe('cursor helpers', () => {
      it('encodeCursor / decodeCursor round-trip', () => {
        const cur = { k: 'date' as const, occurredAt: '2026-04-25T00:00:00.000Z', id: 'p1' };
        const enc = encodeCursor(cur);
        expect(decodeCursor(enc)).toEqual(cur);
      });

      it('decodeCursor returns null for non-base64 garbage', () => {
        // Buffer.from handles most inputs leniently; ensure bad JSON returns null.
        const garbage = Buffer.from('not json', 'utf8').toString('base64url');
        expect(decodeCursor(garbage)).toBeNull();
      });

      it('isValidCursor rejects wrong kind for the active sort', () => {
        expect(isValidCursor({ k: 'amount', amountCents: 1, id: 'x' }, 'date_desc')).toBe(false);
        expect(
          isValidCursor({ k: 'date', occurredAt: '2026-01-01T00:00:00Z', id: 'x' }, 'amount_desc'),
        ).toBe(false);
      });

      it('isValidCursor rejects malformed date string', () => {
        expect(isValidCursor({ k: 'date', occurredAt: 'not-a-date', id: 'x' }, 'date_desc')).toBe(
          false,
        );
      });

      it('buildOrderBy covers all four sorts', () => {
        expect(buildOrderBy('date_desc')).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }]);
        expect(buildOrderBy('date_asc')).toEqual([{ occurredAt: 'asc' }, { id: 'asc' }]);
        expect(buildOrderBy('amount_desc')).toEqual([{ amountCents: 'desc' }, { id: 'desc' }]);
        expect(buildOrderBy('amount_asc')).toEqual([{ amountCents: 'asc' }, { id: 'asc' }]);
      });

      it('buildCursorFor chooses date vs amount by sort', () => {
        const row = { id: 'p1', occurredAt: new Date('2026-04-25T00:00:00Z'), amountCents: 999 };
        expect(buildCursorFor(row, 'date_desc')).toEqual({
          k: 'date',
          occurredAt: '2026-04-25T00:00:00.000Z',
          id: 'p1',
        });
        expect(buildCursorFor(row, 'amount_asc')).toEqual({
          k: 'amount',
          amountCents: 999,
          id: 'p1',
        });
      });

      it('buildCursorGuard builds correct OR for each sort direction', () => {
        const date = { k: 'date' as const, occurredAt: '2026-04-25T00:00:00Z', id: 'p1' };
        const amt = { k: 'amount' as const, amountCents: 500, id: 'p1' };
        expect(buildCursorGuard(date, 'date_desc')).toEqual({
          OR: [
            { occurredAt: { lt: new Date('2026-04-25T00:00:00Z') } },
            { occurredAt: new Date('2026-04-25T00:00:00Z'), id: { lt: 'p1' } },
          ],
        });
        expect(buildCursorGuard(amt, 'amount_asc')).toEqual({
          OR: [{ amountCents: { gt: 500 } }, { amountCents: 500, id: { gt: 'p1' } }],
        });
      });
    });
  });

  // ── serializer ──

  describe('mapPaymentToSummary()', () => {
    it('produces ISO strings and the default zero/false counters', () => {
      const dto = mapPaymentToSummary(makePersistedPayment(), { starredByMe: false });
      expect(dto.occurredAt).toBe('2026-04-25T00:00:00.000Z');
      expect(dto.commentCount).toBe(0);
      expect(dto.hasDocuments).toBe(false);
      expect(dto.starredByMe).toBe(false);
    });

    it('respects starredByMe=true and commentCount/hasDocuments overrides', () => {
      const dto = mapPaymentToSummary(makePersistedPayment(), {
        starredByMe: true,
        commentCount: 3,
        hasDocuments: true,
      });
      expect(dto.starredByMe).toBe(true);
      expect(dto.commentCount).toBe(3);
      expect(dto.hasDocuments).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Iteration 6.7 — findByIdForUser() + update()
  // ──────────────────────────────────────────────────────────────────────────

  /** Full-include shape returned by prisma for get/update paths. */
  const makeFullRow = (over: Record<string, unknown> = {}) => ({
    ...makePersistedPayment(),
    categoryId: 'cat-1',
    stars: [] as Array<{ id: string }>,
    _count: { comments: 0, documents: 0 },
    ...over,
  });

  describe('findByIdForUser()', () => {
    it("returns summary for the creator's own personal payment", async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      const r = await service.findByIdForUser('user-1', 'pay-1');
      expect(r.id).toBe('pay-1');
      expect(r.starredByMe).toBe(false);
      expect(r.commentCount).toBe(0);
      expect(r.hasDocuments).toBe(false);
      // Visibility predicate shape must be present on the where clause.
      const arg = prismaMock.payment.findFirst.mock.calls[0][0] as {
        where: { AND: Array<Record<string, unknown>> };
      };
      expect(arg.where.AND[0]).toEqual({ id: 'pay-1' });
      expect(arg.where.AND[1]).toEqual({
        attributions: {
          some: {
            OR: [
              { scopeType: 'personal', userId: 'user-1' },
              { scopeType: 'group', group: { memberships: { some: { userId: 'user-1' } } } },
            ],
          },
        },
      });
    });

    it('returns summary for a group member viewing a group payment', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(
        makeFullRow({
          createdById: 'user-other',
          attributions: [
            { scopeType: 'group', userId: null, groupId: 'g1', group: { name: 'Fam' } },
          ],
        }),
      );
      const r = await service.findByIdForUser('user-1', 'pay-1');
      expect(r.attributions[0].groupId).toBe('g1');
    });

    it('throws PAYMENT_NOT_FOUND when prisma returns null (non-member on group payment)', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);
      await expect(service.findByIdForUser('user-1', 'pay-1')).rejects.toThrow(NotFoundException);
      try {
        await service.findByIdForUser('user-1', 'pay-1');
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NOT_FOUND);
      }
    });

    it('throws PAYMENT_NOT_FOUND for a completely unknown id', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);
      try {
        await service.findByIdForUser('user-1', 'unknown-id');
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NOT_FOUND);
      }
    });

    it('does not leak existence — 404 (not 403) when visibility fails', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);
      await expect(service.findByIdForUser('user-1', 'pay-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps stars.length/starredByMe and _count fields', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(
        makeFullRow({ stars: [{ id: 's1' }], _count: { comments: 4, documents: 2 } }),
      );
      const r = await service.findByIdForUser('user-1', 'pay-1');
      expect(r.starredByMe).toBe(true);
      expect(r.commentCount).toBe(4);
      expect(r.hasDocuments).toBe(true);
    });
  });

  describe('update()', () => {
    beforeEach(() => {
      categoryServiceMock.findById.mockResolvedValue(okCategory());
      // The update() flow writes via payment.update then reloads via findUnique.
      // Mirror the write in the subsequent findUnique so the summary reflects the edit.
      prismaMock.payment.update.mockImplementation(async ({ data }: { data: unknown }) => {
        const merged = { ...makeFullRow(), ...(data as Record<string, unknown>) };
        prismaMock.payment.findUnique.mockResolvedValue(merged);
        return merged;
      });
      // Default reload mirrors the row from findFirst.
      prismaMock.payment.findUnique.mockImplementation(async () => {
        const last = prismaMock.payment.findFirst.mock.results.slice(-1)[0];
        return last ? await last.value : makeFullRow();
      });
    });

    it('edits note only → single-field prisma update + audit with changed=["note"]', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());

      await service.update('user-1', 'pay-1', { note: 'updated' });

      const updateArg = prismaMock.payment.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(updateArg.where).toEqual({ id: 'pay-1' });
      expect(Object.keys(updateArg.data)).toEqual(['note']);
      expect(updateArg.data.note).toBe('updated');

      await new Promise((res) => setImmediate(res));
      const auditArg = prismaMock.auditLog.create.mock.calls.find(
        (c) => (c[0] as { data: { action: string } }).data.action === 'PAYMENT_UPDATED',
      )?.[0] as { data: { details: { changed: string[] } } };
      expect(auditArg.data.details.changed).toEqual(['note']);
    });

    it('edits multiple scalars at once (amount, currency, occurredAt, categoryId)', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      categoryServiceMock.findById.mockResolvedValue(okCategory({ id: 'cat-2', direction: 'OUT' }));

      await service.update('user-1', 'pay-1', {
        amountCents: 9999,
        currency: 'EUR',
        occurredAt: '2026-04-30',
        categoryId: 'cat-2',
      });

      const updateArg = prismaMock.payment.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateArg.data.amountCents).toBe(9999);
      expect(updateArg.data.currency).toBe('EUR');
      expect(updateArg.data.occurredAt).toBeInstanceOf(Date);
      expect(updateArg.data.category).toEqual({ connect: { id: 'cat-2' } });
    });

    it('empty body → no prisma.update, returns existing row', async () => {
      const row = makeFullRow();
      prismaMock.payment.findFirst.mockResolvedValue(row);

      const r = await service.update('user-1', 'pay-1', {});

      expect(prismaMock.payment.update).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
      expect(r).not.toBeNull();
      expect(r!.id).toBe('pay-1');
    });

    it('403 PAYMENT_NOT_OWNER when caller is not the creator', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow({ createdById: 'user-other' }));
      await expect(service.update('user-1', 'pay-1', { note: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
      try {
        await service.update('user-1', 'pay-1', { note: 'x' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NOT_OWNER);
      }
    });

    it('404 PAYMENT_NOT_FOUND when the row is not visible', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);
      await expect(service.update('user-1', 'pay-1', { note: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      try {
        await service.update('user-1', 'pay-1', { note: 'x' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NOT_FOUND);
      }
    });

    it('400 PAYMENT_CANNOT_EDIT_GENERATED_OCCURRENCE when parentPaymentId is set', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow({ parentPaymentId: 'parent-1' }));
      try {
        await service.update('user-1', 'pay-1', { note: 'x' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_CANNOT_EDIT_GENERATED_OCCURRENCE);
      }
    });

    it('400 PAYMENT_CANNOT_EDIT_GENERATED_OCCURRENCE for type=RECURRING', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow({ type: 'RECURRING' }));
      try {
        await service.update('user-1', 'pay-1', { note: 'x' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_CANNOT_EDIT_GENERATED_OCCURRENCE);
      }
    });

    it('direction change to IN with current OUT category → 400 PAYMENT_CATEGORY_DIRECTION_MISMATCH', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow()); // OUT category
      categoryServiceMock.findById.mockResolvedValue(okCategory({ direction: 'OUT' }));

      try {
        await service.update('user-1', 'pay-1', { direction: 'IN' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_CATEGORY_DIRECTION_MISMATCH);
      }
    });

    it('direction IN + categoryId switch to an IN category succeeds', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      categoryServiceMock.findById.mockResolvedValue(okCategory({ id: 'cat-in', direction: 'IN' }));

      await expect(
        service.update('user-1', 'pay-1', { direction: 'IN', categoryId: 'cat-in' }),
      ).resolves.toBeDefined();

      const updateArg = prismaMock.payment.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateArg.data.direction).toBe('IN');
      expect(updateArg.data.category).toEqual({ connect: { id: 'cat-in' } });
    });

    it('category change to one not visible to user → 404 PAYMENT_INVALID_CATEGORY', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      categoryServiceMock.findById.mockRejectedValue(new NotFoundException('gone'));
      try {
        await service.update('user-1', 'pay-1', { categoryId: 'unknown-cat' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_CATEGORY);
      }
    });

    it('category change to a BOTH-direction category succeeds regardless of direction', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow({ direction: 'IN' }));
      categoryServiceMock.findById.mockResolvedValue(
        okCategory({ id: 'cat-both', direction: 'BOTH' }),
      );
      await expect(
        service.update('user-1', 'pay-1', { categoryId: 'cat-both' }),
      ).resolves.toBeDefined();
    });

    it('future occurredAt (>1 day) → 400 PAYMENT_INVALID_DATE', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      const far = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await service.update('user-1', 'pay-1', { occurredAt: far });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_DATE);
      }
    });

    it('amount > 1e11 cents → 400 PAYMENT_INVALID_AMOUNT', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      try {
        await service.update('user-1', 'pay-1', { amountCents: 1e11 + 1 });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT);
      }
    });

    it('note="" is coerced to null in the prisma data payload', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow({ note: 'before' }));
      await service.update('user-1', 'pay-1', { note: '' });
      const updateArg = prismaMock.payment.update.mock.calls[0][0] as {
        data: { note: unknown };
      };
      expect(updateArg.data.note).toBeNull();
    });

    it('audit "changed" array is sorted alphabetically', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      await service.update('user-1', 'pay-1', {
        note: 'n',
        amountCents: 50,
        currency: 'EUR',
      });
      await new Promise((res) => setImmediate(res));
      const auditArg = prismaMock.auditLog.create.mock.calls.find(
        (c) => (c[0] as { data: { action: string } }).data.action === 'PAYMENT_UPDATED',
      )?.[0] as { data: { details: { changed: string[] } } };
      expect(auditArg.data.details.changed).toEqual(['amountCents', 'currency', 'note']);
    });

    it('returned summary reflects the updated amountCents', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      const r = await service.update('user-1', 'pay-1', { amountCents: 4242 });
      expect(r).not.toBeNull();
      expect(r!.amountCents).toBe(4242);
    });

    it('rejects unsupported currency on update', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      try {
        await service.update('user-1', 'pay-1', { currency: 'ZZZ' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_CURRENCY);
      }
    });

    it('does not fail when audit log throws', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      prismaMock.auditLog.create.mockRejectedValueOnce(new Error('audit down'));
      await expect(service.update('user-1', 'pay-1', { note: 'x' })).resolves.toBeDefined();
    });

    it('direction change with no category change validates against existing category', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow()); // existing OUT category
      categoryServiceMock.findById.mockResolvedValue(okCategory({ direction: 'BOTH' }));

      await expect(service.update('user-1', 'pay-1', { direction: 'IN' })).resolves.toBeDefined();
      // categoryService.findById was called with the payment's existing category id.
      expect(categoryServiceMock.findById).toHaveBeenCalledWith('user-1', 'cat-1');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Iteration 6.8 — remove() + update() with attributions
  // ──────────────────────────────────────────────────────────────────────────

  /** Build a row shaped like what prisma returns from findUnique + attributions include. */
  const makeRawRow = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1250,
    currency: 'USD',
    occurredAt: new Date('2026-04-25T00:00:00Z'),
    status: 'POSTED',
    categoryId: 'cat-1',
    note: null,
    parentPaymentId: null,
    createdById: 'user-1',
    createdAt: now,
    updatedAt: now,
    attributions: [
      { id: 'attr-p', paymentId: 'pay-1', scopeType: 'personal', userId: 'user-1', groupId: null },
    ] as Array<{
      id: string;
      paymentId: string;
      scopeType: string;
      userId: string | null;
      groupId: string | null;
    }>,
    ...over,
  });

  describe('remove()', () => {
    it('explicit scope=personal: removes the personal attribution; payment survives', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            {
              id: 'attr-p',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-1',
              groupId: null,
            },
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(1); // group remains
      // Second findUnique: reload after remove.
      prismaMock.payment.findUnique.mockResolvedValueOnce(makeFullRow());

      const r = await service.remove('user-1', 'pay-1', { scope: 'personal' });
      expect(r.deletedAttributions).toBe(1);
      expect(r.paymentDeleted).toBe(false);
      expect(prismaMock.paymentAttribution.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['attr-p'] } },
      });
      expect(prismaMock.payment.delete).not.toHaveBeenCalled();
    });

    it('explicit scope=group:<id> as member: removes that group attribution', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            {
              id: 'attr-p',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-1',
              groupId: null,
            },
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(1);
      prismaMock.payment.findUnique.mockResolvedValueOnce(makeFullRow());

      const r = await service.remove('user-1', 'pay-1', { scope: 'group:g1' });
      expect(prismaMock.paymentAttribution.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['attr-g'] } },
      });
      expect(r.paymentDeleted).toBe(false);
    });

    it('explicit scope=group:<id> as non-member: 404 PAYMENT_NOT_FOUND (no visible attribution)', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          createdById: 'user-other',
          attributions: [
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([]); // user-1 not a member

      await expect(service.remove('user-1', 'pay-1', { scope: 'group:g1' })).rejects.toThrow(
        NotFoundException,
      );
      try {
        prismaMock.payment.findUnique.mockResolvedValueOnce(
          makeRawRow({
            createdById: 'user-other',
            attributions: [
              { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
            ],
          }),
        );
        await service.remove('user-1', 'pay-1', { scope: 'group:g1' });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NOT_FOUND);
      }
    });

    it('explicit scope=all: removes every accessible attribution; deletes payment when none remain', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            {
              id: 'attr-p',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-1',
              groupId: null,
            },
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(0); // nothing left

      const r = await service.remove('user-1', 'pay-1', { scope: 'all' });
      expect(r.deletedAttributions).toBe(2);
      expect(r.paymentDeleted).toBe(true);
      expect(r.payment).toBeNull();
      expect(prismaMock.payment.delete).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
    });

    it("scope=all preserves other users' personal attributions", async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            {
              id: 'attr-p',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-1',
              groupId: null,
            },
            // another user's personal — NOT accessible to user-1
            {
              id: 'attr-other',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-other',
              groupId: null,
            },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.paymentAttribution.count.mockResolvedValue(1); // other remains
      prismaMock.payment.findUnique.mockResolvedValueOnce(makeFullRow());

      const r = await service.remove('user-1', 'pay-1', { scope: 'all' });
      expect(r.deletedAttributions).toBe(1);
      expect(r.paymentDeleted).toBe(false);
      // Only caller's attribution was targeted.
      expect(prismaMock.paymentAttribution.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['attr-p'] } },
      });
    });

    it('implicit scope: single accessible attribution → removes it', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(makeRawRow());
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.paymentAttribution.count.mockResolvedValue(0);

      const r = await service.remove('user-1', 'pay-1', {});
      expect(r.paymentDeleted).toBe(true);
      expect(r.deletedAttributions).toBe(1);
    });

    it('implicit scope: multiple accessible → 409 PAYMENT_SCOPE_AMBIGUOUS with accessibleScopes', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            {
              id: 'attr-p',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-1',
              groupId: null,
            },
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);

      await expect(service.remove('user-1', 'pay-1', {})).rejects.toThrow(ConflictException);
      try {
        prismaMock.payment.findUnique.mockResolvedValueOnce(
          makeRawRow({
            attributions: [
              {
                id: 'attr-p',
                paymentId: 'pay-1',
                scopeType: 'personal',
                userId: 'user-1',
                groupId: null,
              },
              { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
            ],
          }),
        );
        await service.remove('user-1', 'pay-1', {});
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_SCOPE_AMBIGUOUS);
        const details = (
          err as { getResponse?: () => { details?: { accessibleScopes?: string[] } } }
        ).getResponse?.().details;
        expect(details?.accessibleScopes).toEqual(['personal', 'group:g1']);
      }
    });

    it('scope=personal when user never had personal → 409 PAYMENT_SCOPE_NOT_ATTRIBUTED', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      try {
        await service.remove('user-1', 'pay-1', { scope: 'personal' });
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_SCOPE_NOT_ATTRIBUTED);
      }
    });

    it('non-visible payment (no id) → 404', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove('user-1', 'pay-1', {})).rejects.toThrow(NotFoundException);
    });

    it('fires PAYMENT_ATTRIBUTION_REMOVED once per deletion + PAYMENT_DELETED when payment is hard-deleted', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            {
              id: 'attr-p',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-1',
              groupId: null,
            },
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(0);

      await service.remove('user-1', 'pay-1', { scope: 'all' });
      await new Promise((res) => setImmediate(res));

      const actions = prismaMock.auditLog.create.mock.calls.map(
        (c) => (c[0] as { data: { action: string } }).data.action,
      );
      expect(actions.filter((a) => a === 'PAYMENT_ATTRIBUTION_REMOVED')).toHaveLength(2);
      expect(actions).toContain('PAYMENT_DELETED');
    });

    it('does NOT fire PAYMENT_DELETED when attributions still remain', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        makeRawRow({
          attributions: [
            {
              id: 'attr-p',
              paymentId: 'pay-1',
              scopeType: 'personal',
              userId: 'user-1',
              groupId: null,
            },
            { id: 'attr-g', paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' },
          ],
        }),
      );
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(1);
      prismaMock.payment.findUnique.mockResolvedValueOnce(makeFullRow());

      await service.remove('user-1', 'pay-1', { scope: 'personal' });
      await new Promise((res) => setImmediate(res));

      const actions = prismaMock.auditLog.create.mock.calls.map(
        (c) => (c[0] as { data: { action: string } }).data.action,
      );
      expect(actions).not.toContain('PAYMENT_DELETED');
    });

    it('uses prisma.$transaction; throw inside it propagates', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(makeRawRow());
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.$transaction.mockRejectedValueOnce(new Error('db crash'));
      await expect(service.remove('user-1', 'pay-1', { scope: 'personal' })).rejects.toThrow(
        'db crash',
      );
    });

    it('audit failure does not break the main operation', async () => {
      prismaMock.payment.findUnique.mockResolvedValueOnce(makeRawRow());
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.paymentAttribution.count.mockResolvedValue(0);
      prismaMock.auditLog.create.mockRejectedValueOnce(new Error('audit down'));
      await expect(service.remove('user-1', 'pay-1', { scope: 'personal' })).resolves.toBeDefined();
    });
  });

  describe('update() with attributions', () => {
    beforeEach(() => {
      categoryServiceMock.findById.mockResolvedValue(okCategory());
      prismaMock.payment.update.mockImplementation(async ({ data }: { data: unknown }) => {
        const merged = { ...makeFullRow(), ...(data as Record<string, unknown>) };
        prismaMock.payment.findUnique.mockResolvedValue(merged);
        return merged;
      });
      prismaMock.payment.findUnique.mockImplementation(async () => {
        const last = prismaMock.payment.findFirst.mock.results.slice(-1)[0];
        return last ? await last.value : makeFullRow();
      });
    });

    /** findFirst returns the full visibility-loaded row with raw attributions. */
    const fullRowWithAttrs = (
      attrs: Array<{
        id: string;
        scopeType: string;
        userId: string | null;
        groupId: string | null;
        group?: { name: string } | null;
      }>,
    ) =>
      makeFullRow({
        attributions: attrs.map((a) => ({ ...a, group: a.group ?? null, paymentId: 'pay-1' })),
      });

    it('attributions identical to current accessible → no DB write, returns summary', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-p', scopeType: 'personal', userId: 'user-1', groupId: null },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.paymentAttribution.count.mockResolvedValue(1);

      await service.update('user-1', 'pay-1', { attributions: [{ scope: 'personal' }] });
      expect(prismaMock.paymentAttribution.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.paymentAttribution.createMany).not.toHaveBeenCalled();
    });

    it('empty array removes all accessible → payment deleted → returns null', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-p', scopeType: 'personal', userId: 'user-1', groupId: null },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      prismaMock.paymentAttribution.count.mockResolvedValue(0);

      const r = await service.update('user-1', 'pay-1', { attributions: [] });
      expect(r).toBeNull();
      expect(prismaMock.paymentAttribution.deleteMany).toHaveBeenCalled();
      expect(prismaMock.payment.delete).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
    });

    it('adds a new group attribution for a member group', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-p', scopeType: 'personal', userId: 'user-1', groupId: null },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(2);

      await service.update('user-1', 'pay-1', {
        attributions: [{ scope: 'personal' }, { scope: 'group', groupId: 'g1' }],
      });

      expect(prismaMock.paymentAttribution.createMany).toHaveBeenCalledWith({
        data: [{ paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g1' }],
      });
      expect(prismaMock.paymentAttribution.deleteMany).not.toHaveBeenCalled();
      await new Promise((res) => setImmediate(res));
      const actions = prismaMock.auditLog.create.mock.calls.map(
        (c) => (c[0] as { data: { action: string } }).data.action,
      );
      expect(actions).toContain('PAYMENT_ATTRIBUTION_ADDED');
    });

    it('removes personal while keeping group', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-p', scopeType: 'personal', userId: 'user-1', groupId: null },
        { id: 'attr-g', scopeType: 'group', userId: null, groupId: 'g1' },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(1);

      await service.update('user-1', 'pay-1', {
        attributions: [{ scope: 'group', groupId: 'g1' }],
      });
      expect(prismaMock.paymentAttribution.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['attr-p'] } },
      });
      expect(prismaMock.paymentAttribution.createMany).not.toHaveBeenCalled();
    });

    it('replaces group g1 with g2 when user is a member of both', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-g1', scopeType: 'group', userId: null, groupId: 'g1' },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }, { groupId: 'g2' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(1);

      await service.update('user-1', 'pay-1', {
        attributions: [{ scope: 'group', groupId: 'g2' }],
      });
      expect(prismaMock.paymentAttribution.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['attr-g1'] } },
      });
      expect(prismaMock.paymentAttribution.createMany).toHaveBeenCalledWith({
        data: [{ paymentId: 'pay-1', scopeType: 'group', userId: null, groupId: 'g2' }],
      });
    });

    it('desired group the user is not a member of → 403 PAYMENT_ATTRIBUTION_OUT_OF_SCOPE', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-p', scopeType: 'personal', userId: 'user-1', groupId: null },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([]); // not a member of anything

      try {
        await service.update('user-1', 'pay-1', {
          attributions: [{ scope: 'personal' }, { scope: 'group', groupId: 'g-nope' }],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_ATTRIBUTION_OUT_OF_SCOPE);
      }
    });

    it("desired attribution collides with another user's personal → 403 PAYMENT_ATTRIBUTION_OUT_OF_SCOPE", async () => {
      const row = fullRowWithAttrs([
        // Caller's group is accessible, another user's personal is on the payment but not accessible.
        { id: 'attr-g', scopeType: 'group', userId: null, groupId: 'g1' },
        { id: 'attr-other', scopeType: 'personal', userId: 'user-other', groupId: null },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);

      // Caller attempts to "add" personal — collides with user-other's personal row.
      try {
        await service.update('user-1', 'pay-1', {
          attributions: [{ scope: 'group', groupId: 'g1' }, { scope: 'personal' }],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_ATTRIBUTION_OUT_OF_SCOPE);
      }
    });

    it('duplicate in desired → 400 PAYMENT_DUPLICATE_ATTRIBUTION', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      try {
        await service.update('user-1', 'pay-1', {
          attributions: [{ scope: 'personal' }, { scope: 'personal' }],
        });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_DUPLICATE_ATTRIBUTION);
      }
    });

    it('malformed attribution → 400 PAYMENT_INVALID_ATTRIBUTION', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(makeFullRow());
      prismaMock.groupMembership.findMany.mockResolvedValue([]);
      try {
        await service.update('user-1', 'pay-1', {
          attributions: [{ scope: 'group' }], // missing groupId
        });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_INVALID_ATTRIBUTION);
      }
    });

    it('non-creator with attributions in body → 403 PAYMENT_NOT_OWNER', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-g', scopeType: 'group', userId: null, groupId: 'g1' },
      ]);
      row.createdById = 'user-other';
      prismaMock.payment.findFirst.mockResolvedValue(row);
      try {
        await service.update('user-1', 'pay-1', { attributions: [] });
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NOT_OWNER);
      }
    });

    it('attribution edit + scalar edit happen in one $transaction', async () => {
      const row = fullRowWithAttrs([
        { id: 'attr-p', scopeType: 'personal', userId: 'user-1', groupId: null },
      ]);
      prismaMock.payment.findFirst.mockResolvedValue(row);
      prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'g1' }]);
      prismaMock.paymentAttribution.count.mockResolvedValue(2);

      await service.update('user-1', 'pay-1', {
        note: 'combined',
        attributions: [{ scope: 'personal' }, { scope: 'group', groupId: 'g1' }],
      });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.payment.update).toHaveBeenCalled();
      expect(prismaMock.paymentAttribution.createMany).toHaveBeenCalled();
      await new Promise((res) => setImmediate(res));
      const actions = prismaMock.auditLog.create.mock.calls.map(
        (c) => (c[0] as { data: { action: string } }).data.action,
      );
      expect(actions).toContain('PAYMENT_UPDATED');
      expect(actions).toContain('PAYMENT_ATTRIBUTION_ADDED');
    });
  });
});
