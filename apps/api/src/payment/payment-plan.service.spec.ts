import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { PaymentPlanService } from './payment-plan.service';
import { PaymentService } from './payment.service';

const codeOf = (err: unknown): string | undefined =>
  ((err as { getResponse?: () => { errorCode?: string } }).getResponse?.() ?? {}).errorCode;

describe('PaymentPlanService', () => {
  const prismaMock = {
    payment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    paymentPlan: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };

  const paymentServiceMock = {
    assertVisible: jest.fn(),
  };

  let service: PaymentPlanService;

  const makePlanRow = (over: Record<string, unknown> = {}) => ({
    id: 'plan-1',
    paymentId: 'pay-1',
    kind: 'INSTALLMENT',
    principalCents: 120_000,
    interestRate: new Prisma.Decimal(0),
    paymentsCount: 12,
    frequency: 'MONTHLY',
    firstDueAt: new Date('2026-08-01T00:00:00.000Z'),
    amortizationMethod: 'equal',
    cancelledAt: null,
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:00.000Z'),
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Array-form $transaction (used by cancel): resolve the given promises.
    prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    prismaMock.payment.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentPlanService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PaymentService, useValue: paymentServiceMock },
      ],
    }).compile();
    service = module.get(PaymentPlanService);
  });

  describe('get', () => {
    it('asserts visibility, then returns the plan with recomputed rows + child join', async () => {
      paymentServiceMock.assertVisible.mockResolvedValue(undefined);
      prismaMock.paymentPlan.findUnique.mockResolvedValue(makePlanRow());
      prismaMock.payment.findMany.mockResolvedValue([
        { id: 'child-1', status: 'PENDING', idempotencyKey: 'plan:plan-1:1' },
        { id: 'child-12', status: 'CANCELLED', idempotencyKey: 'plan:plan-1:12' },
      ]);

      const res = await service.get('u1', 'pay-1');

      expect(paymentServiceMock.assertVisible).toHaveBeenCalledWith('u1', 'pay-1');
      expect(res.kind).toBe('INSTALLMENT');
      expect(res.principalCents).toBe(120_000);
      expect(res.rows).toHaveLength(12);
      // $1200 / 12 → $100 per row (fixture math).
      expect(res.rows[0]).toEqual(
        expect.objectContaining({
          index: 1,
          principalCents: 10_000,
          interestCents: 0,
          totalCents: 10_000,
          occurrenceId: 'child-1',
          status: 'PENDING',
        }),
      );
      // Joined by deterministic idempotencyKey index, not array order.
      expect(res.rows[11]).toEqual(
        expect.objectContaining({ index: 12, occurrenceId: 'child-12', status: 'CANCELLED' }),
      );
      // Unmatched rows stay null (hard-deleted children).
      expect(res.rows[5].occurrenceId).toBeNull();
      expect(res.rows[11].remainingCents).toBe(0);
    });

    it('404s with PAYMENT_PLAN_NOT_FOUND when the payment has no plan', async () => {
      paymentServiceMock.assertVisible.mockResolvedValue(undefined);
      prismaMock.paymentPlan.findUnique.mockResolvedValue(null);
      await expect(service.get('u1', 'pay-1')).rejects.toThrow(NotFoundException);
      try {
        await service.get('u1', 'pay-1');
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_PLAN_NOT_FOUND);
      }
    });

    it('propagates the visibility rejection untouched', async () => {
      paymentServiceMock.assertVisible.mockRejectedValue(new NotFoundException());
      await expect(service.get('u1', 'pay-1')).rejects.toThrow(NotFoundException);
      expect(prismaMock.paymentPlan.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay-1' });
      prismaMock.paymentPlan.update.mockResolvedValue(makePlanRow());
      prismaMock.payment.updateMany.mockResolvedValue({ count: 7 });
    });

    it('creator: stamps cancelledAt and flips PENDING children to CANCELLED', async () => {
      prismaMock.paymentPlan.findUnique.mockResolvedValue(makePlanRow());

      const res = await service.cancel('u1', 'pay-1');

      // Creator gate queried with both id + createdById.
      expect(prismaMock.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pay-1', createdById: 'u1' } }),
      );
      expect(prismaMock.paymentPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-1' },
          data: { cancelledAt: expect.any(Date) },
        }),
      );
      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: { parentPaymentId: 'pay-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      expect(res.cancelledAt).toEqual(expect.any(String));
      // Audit written with the flipped-children count.
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PAYMENT_PLAN_CANCELLED',
            details: expect.objectContaining({ cancelledChildren: 7 }),
          }),
        }),
      );
    });

    it('404s for non-creators without leaking existence', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);
      try {
        await service.cancel('intruder', 'pay-1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_NOT_FOUND);
      }
      expect(prismaMock.paymentPlan.update).not.toHaveBeenCalled();
    });

    it('404s with PAYMENT_PLAN_NOT_FOUND when no plan exists', async () => {
      prismaMock.paymentPlan.findUnique.mockResolvedValue(null);
      try {
        await service.cancel('u1', 'pay-1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_PLAN_NOT_FOUND);
      }
    });

    it('409s on repeat cancellation (terminal state)', async () => {
      prismaMock.paymentPlan.findUnique.mockResolvedValue(
        makePlanRow({ cancelledAt: new Date('2026-07-01T00:00:00.000Z') }),
      );
      await expect(service.cancel('u1', 'pay-1')).rejects.toThrow(ConflictException);
      try {
        await service.cancel('u1', 'pay-1');
      } catch (err) {
        expect(codeOf(err)).toBe(PAYMENT_ERRORS.PAYMENT_PLAN_ALREADY_CANCELLED);
      }
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });
  });
});
