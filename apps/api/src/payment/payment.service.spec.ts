import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { mapPaymentToSummary, PaymentService, PaymentWithRelations } from './payment.service';

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
    },
    groupMembership: {
      findMany: jest.fn(),
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
      cb({ payment: prismaMock.payment }),
    );
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
});
