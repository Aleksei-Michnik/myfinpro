import type { AmortizationMethod, PaymentFrequency } from '@myfinpro/shared';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentPlan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { mapPlanRowToDto, PlanResponseDto, PlanRowDto } from './dto/plan-response.dto';
import { PaymentService } from './payment.service';
import { calculateAmortization } from './utils/amortization.util';

/**
 * Phase 6, iteration 6.19 — `PaymentPlan` domain service (read + cancel).
 *
 * Creation lives in [`payment-plan.create.ts`](./payment-plan.create.ts) and
 * runs INSIDE `PaymentService.create()`'s transaction — the plan body arrives
 * inline on `POST /payments` when `type ∈ PAYMENT_PLAN_KINDS`, because a plan
 * parent without its pre-generated occurrence rows would be a broken
 * invariant, not a transient state (unlike the two-step schedule create).
 *
 * Cancellation (DELETE /payments/:id/plan) is terminal: it stamps
 * `cancelledAt` and flips the remaining PENDING children to CANCELLED —
 * rows are never deleted, for audit. PATCH (regenerate) is deferred; see
 * design §5.6 ("these endpoints exist for advanced edits").
 */
@Injectable()
export class PaymentPlanService {
  private readonly logger = new Logger(PaymentPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  /** GET /payments/:paymentId/plan — any accessor of the parent payment. */
  async get(userId: string, paymentId: string): Promise<PlanResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);
    const plan = await this.prisma.paymentPlan.findUnique({ where: { paymentId } });
    if (!plan) {
      throw new NotFoundException({
        message: 'Plan not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_PLAN_NOT_FOUND,
      });
    }
    return this.toResponse(plan);
  }

  /**
   * DELETE /payments/:paymentId/plan — creator-only, terminal.
   * Stamps `cancelledAt` and flips remaining PENDING children to CANCELLED
   * in one transaction. Returns the updated plan (with rows) so the UI can
   * re-render without a second fetch.
   */
  async cancel(userId: string, paymentId: string): Promise<PlanResponseDto> {
    const parent = await this.prisma.payment.findFirst({
      where: { id: paymentId, createdById: userId },
      select: { id: true },
    });
    if (!parent) {
      // Mirrors the schedule lifecycle: non-creators and non-existent
      // payments both read as 404 to avoid existence leaks.
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }
    const plan = await this.prisma.paymentPlan.findUnique({ where: { paymentId } });
    if (!plan) {
      throw new NotFoundException({
        message: 'Plan not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_PLAN_NOT_FOUND,
      });
    }
    if (plan.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Plan is already cancelled',
        errorCode: PAYMENT_ERRORS.PAYMENT_PLAN_ALREADY_CANCELLED,
      });
    }

    const cancelledAt = new Date();
    const [, flipped] = await this.prisma.$transaction([
      this.prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { cancelledAt },
      }),
      this.prisma.payment.updateMany({
        where: { parentPaymentId: paymentId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      }),
    ]);

    void this.writeAudit(userId, paymentId, 'PAYMENT_PLAN_CANCELLED', {
      planId: plan.id,
      cancelledAt: cancelledAt.toISOString(),
      cancelledChildren: flipped.count,
    });
    this.logger.log(
      `Plan ${plan.id} (payment ${paymentId}) cancelled by user ${userId}; ` +
        `${flipped.count} pending occurrences flipped to CANCELLED`,
    );

    return this.toResponse({ ...plan, cancelledAt });
  }

  /**
   * Recompute the amortisation table from the persisted parameters and join
   * the child rows (by their deterministic `idempotencyKey`) for per-row
   * occurrence id + status.
   */
  private async toResponse(plan: PaymentPlan): Promise<PlanResponseDto> {
    const rows = calculateAmortization({
      principalCents: plan.principalCents,
      interestRate: Number(plan.interestRate),
      paymentsCount: plan.paymentsCount,
      method: plan.amortizationMethod as AmortizationMethod,
      firstDueAt: plan.firstDueAt,
      frequency: plan.frequency as PaymentFrequency,
    });

    const children = await this.prisma.payment.findMany({
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
    paymentId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Payment',
          entityId: paymentId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write ${action} audit log for payment ${paymentId}: ${(err as Error).message}`,
      );
    }
  }
}
