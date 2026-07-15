import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSACTION_ERRORS } from './constants/transaction-errors';
import { TransactionPlanService } from './transaction-plan.service';
import { TransactionService } from './transaction.service';

const codeOf = (err: unknown): string | undefined =>
  ((err as { getResponse?: () => { errorCode?: string } }).getResponse?.() ?? {}).errorCode;

describe('TransactionPlanService', () => {
  const prismaMock = {
    transaction: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    transactionPlan: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };

  const transactionServiceMock = {
    assertVisible: jest.fn(),
  };

  let service: TransactionPlanService;

  const makePlanRow = (over: Record<string, unknown> = {}) => ({
    id: 'plan-1',
    transactionId: 'pay-1',
    kind: 'INSTALLMENT',
    principalCents: 120_000,
    interestRate: new Prisma.Decimal(0),
    transactionsCount: 12,
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
    prismaMock.transaction.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionPlanService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TransactionService, useValue: transactionServiceMock },
      ],
    }).compile();
    service = module.get(TransactionPlanService);
  });

  describe('get', () => {
    it('asserts visibility, then returns the plan with recomputed rows + child join', async () => {
      transactionServiceMock.assertVisible.mockResolvedValue(undefined);
      prismaMock.transactionPlan.findUnique.mockResolvedValue(makePlanRow());
      prismaMock.transaction.findMany.mockResolvedValue([
        { id: 'child-1', status: 'PENDING', idempotencyKey: 'plan:plan-1:1' },
        { id: 'child-12', status: 'CANCELLED', idempotencyKey: 'plan:plan-1:12' },
      ]);

      const res = await service.get('u1', 'pay-1');

      expect(transactionServiceMock.assertVisible).toHaveBeenCalledWith('u1', 'pay-1');
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

    it('404s with TRANSACTION_PLAN_NOT_FOUND when the transaction has no plan', async () => {
      transactionServiceMock.assertVisible.mockResolvedValue(undefined);
      prismaMock.transactionPlan.findUnique.mockResolvedValue(null);
      await expect(service.get('u1', 'pay-1')).rejects.toThrow(NotFoundException);
      try {
        await service.get('u1', 'pay-1');
      } catch (err) {
        expect(codeOf(err)).toBe(TRANSACTION_ERRORS.TRANSACTION_PLAN_NOT_FOUND);
      }
    });

    it('propagates the visibility rejection untouched', async () => {
      transactionServiceMock.assertVisible.mockRejectedValue(new NotFoundException());
      await expect(service.get('u1', 'pay-1')).rejects.toThrow(NotFoundException);
      expect(prismaMock.transactionPlan.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      prismaMock.transaction.findFirst.mockResolvedValue({ id: 'pay-1' });
      prismaMock.transactionPlan.update.mockResolvedValue(makePlanRow());
      prismaMock.transaction.updateMany.mockResolvedValue({ count: 7 });
    });

    it('creator: stamps cancelledAt and flips PENDING children to CANCELLED', async () => {
      prismaMock.transactionPlan.findUnique.mockResolvedValue(makePlanRow());

      const res = await service.cancel('u1', 'pay-1');

      // Creator gate queried with both id + createdById.
      expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pay-1', createdById: 'u1' } }),
      );
      expect(prismaMock.transactionPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-1' },
          data: { cancelledAt: expect.any(Date) },
        }),
      );
      expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
        where: { parentTransactionId: 'pay-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      expect(res.cancelledAt).toEqual(expect.any(String));
      // Audit written with the flipped-children count.
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'TRANSACTION_PLAN_CANCELLED',
            details: expect.objectContaining({ cancelledChildren: 7 }),
          }),
        }),
      );
    });

    it('404s for non-creators without leaking existence', async () => {
      prismaMock.transaction.findFirst.mockResolvedValue(null);
      try {
        await service.cancel('intruder', 'pay-1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe(TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND);
      }
      expect(prismaMock.transactionPlan.update).not.toHaveBeenCalled();
    });

    it('404s with TRANSACTION_PLAN_NOT_FOUND when no plan exists', async () => {
      prismaMock.transactionPlan.findUnique.mockResolvedValue(null);
      try {
        await service.cancel('u1', 'pay-1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(codeOf(err)).toBe(TRANSACTION_ERRORS.TRANSACTION_PLAN_NOT_FOUND);
      }
    });

    it('409s on repeat cancellation (terminal state)', async () => {
      prismaMock.transactionPlan.findUnique.mockResolvedValue(
        makePlanRow({ cancelledAt: new Date('2026-07-01T00:00:00.000Z') }),
      );
      await expect(service.cancel('u1', 'pay-1')).rejects.toThrow(ConflictException);
      try {
        await service.cancel('u1', 'pay-1');
      } catch (err) {
        expect(codeOf(err)).toBe(TRANSACTION_ERRORS.TRANSACTION_PLAN_ALREADY_CANCELLED);
      }
      expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
    });
  });
});
