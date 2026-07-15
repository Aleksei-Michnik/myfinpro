import type { AmortizationMethod, TransactionFrequency } from '@myfinpro/shared';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TransactionPlan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSACTION_ERRORS } from './constants/transaction-errors';
import { mapPlanRowToDto, PlanResponseDto, PlanRowDto } from './dto/plan-response.dto';
import { TransactionService } from './transaction.service';
import { calculateAmortization } from './utils/amortization.util';

/**
 * Phase 6, iteration 6.19 — `TransactionPlan` domain service (read + cancel).
 *
 * Creation lives in [`transaction-plan.create.ts`](./transaction-plan.create.ts) and
 * runs INSIDE `TransactionService.create()`'s transaction — the plan body arrives
 * inline on `POST /transactions` when `type ∈ TRANSACTION_PLAN_KINDS`, because a plan
 * parent without its pre-generated occurrence rows would be a broken
 * invariant, not a transient state (unlike the two-step schedule create).
 *
 * Cancellation (DELETE /transactions/:id/plan) is terminal: it stamps
 * `cancelledAt` and flips the remaining PENDING children to CANCELLED —
 * rows are never deleted, for audit. PATCH (regenerate) is deferred; see
 * design §5.6 ("these endpoints exist for advanced edits").
 */
@Injectable()
export class TransactionPlanService {
  private readonly logger = new Logger(TransactionPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
  ) {}

  /** GET /transactions/:transactionId/plan — any accessor of the parent transaction. */
  async get(userId: string, transactionId: string): Promise<PlanResponseDto> {
    await this.transactionService.assertVisible(userId, transactionId);
    const plan = await this.prisma.transactionPlan.findUnique({ where: { transactionId } });
    if (!plan) {
      throw new NotFoundException({
        message: 'Plan not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_PLAN_NOT_FOUND,
      });
    }
    return this.toResponse(plan);
  }

  /**
   * DELETE /transactions/:transactionId/plan — creator-only, terminal.
   * Stamps `cancelledAt` and flips remaining PENDING children to CANCELLED
   * in one transaction. Returns the updated plan (with rows) so the UI can
   * re-render without a second fetch.
   */
  async cancel(userId: string, transactionId: string): Promise<PlanResponseDto> {
    const parent = await this.prisma.transaction.findFirst({
      where: { id: transactionId, createdById: userId },
      select: { id: true },
    });
    if (!parent) {
      // Mirrors the schedule lifecycle: non-creators and non-existent
      // transactions both read as 404 to avoid existence leaks.
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }
    const plan = await this.prisma.transactionPlan.findUnique({ where: { transactionId } });
    if (!plan) {
      throw new NotFoundException({
        message: 'Plan not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_PLAN_NOT_FOUND,
      });
    }
    if (plan.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Plan is already cancelled',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_PLAN_ALREADY_CANCELLED,
      });
    }

    const cancelledAt = new Date();
    const [, flipped] = await this.prisma.$transaction([
      this.prisma.transactionPlan.update({
        where: { id: plan.id },
        data: { cancelledAt },
      }),
      this.prisma.transaction.updateMany({
        where: { parentTransactionId: transactionId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      }),
    ]);

    void this.writeAudit(userId, transactionId, 'TRANSACTION_PLAN_CANCELLED', {
      planId: plan.id,
      cancelledAt: cancelledAt.toISOString(),
      cancelledChildren: flipped.count,
    });
    this.logger.log(
      `Plan ${plan.id} (transaction ${transactionId}) cancelled by user ${userId}; ` +
        `${flipped.count} pending occurrences flipped to CANCELLED`,
    );

    return this.toResponse({ ...plan, cancelledAt });
  }

  /**
   * Recompute the amortisation table from the persisted parameters and join
   * the child rows (by their deterministic `idempotencyKey`) for per-row
   * occurrence id + status.
   */
  private async toResponse(plan: TransactionPlan): Promise<PlanResponseDto> {
    const rows = calculateAmortization({
      principalCents: plan.principalCents,
      interestRate: Number(plan.interestRate),
      transactionsCount: plan.transactionsCount,
      method: plan.amortizationMethod as AmortizationMethod,
      firstDueAt: plan.firstDueAt,
      frequency: plan.frequency as TransactionFrequency,
    });

    const children = await this.prisma.transaction.findMany({
      where: { idempotencyKey: { startsWith: `plan:${plan.id}:` } },
      select: { id: true, status: true, idempotencyKey: true },
    });
    const byIndex = new Map<number, { id: string; status: string }>();
    for (const child of children) {
      const index = Number(child.idempotencyKey?.split(':')[2]);
      if (Number.isInteger(index)) byIndex.set(index, { id: child.id, status: child.status });
    }

    const rowDtos: PlanRowDto[] = rows.map((row) => ({
      index: row.index,
      dueAt: row.dueAt.toISOString(),
      principalCents: row.principalCents,
      interestCents: row.interestCents,
      totalCents: row.totalCents,
      remainingCents: row.remainingCents,
      occurrenceId: byIndex.get(row.index)?.id ?? null,
      status: byIndex.get(row.index)?.status ?? null,
    }));

    return mapPlanRowToDto(plan, rowDtos);
  }

  private async writeAudit(
    userId: string,
    transactionId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Transaction',
          entityId: transactionId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write ${action} audit log for transaction ${transactionId}: ${(err as Error).message}`,
      );
    }
  }
}
