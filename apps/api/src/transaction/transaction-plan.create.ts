import type { AmortizationMethod, TransactionPlanKind } from '@myfinpro/shared';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TRANSACTION_ERRORS } from './constants/transaction-errors';
import { CreatePlanDto } from './dto/create-plan.dto';
import { calculateAmortization, type AmortizationRow } from './utils/amortization.util';

// Phase 6, iteration 6.19 — the plan CREATION path, kept as standalone
// functions (not methods on TransactionPlanService) so `TransactionService.create()`
// can call them without a TransactionService ⇄ TransactionPlanService dependency
// cycle: the plan service depends on TransactionService for `assertVisible`,
// while the transaction service only needs this pure/tx-scoped logic.

/** Default amortisation method per plan kind (design §2.2). */
export function defaultPlanMethod(kind: TransactionPlanKind): AmortizationMethod {
  return kind === 'INSTALLMENT' ? 'equal' : 'french';
}

export interface ComputedPlan {
  method: AmortizationMethod;
  firstDueAt: Date;
  rows: AmortizationRow[];
}

/**
 * Validate the inline plan body + compute the amortisation schedule.
 * Pure (no I/O) — `TransactionService.create()` runs this BEFORE opening the
 * transaction so an invalid plan never costs a write.
 */
export function validatePlanAndCompute(
  kind: TransactionPlanKind,
  principalCents: number,
  dto: CreatePlanDto,
): ComputedPlan {
  const method = dto.amortizationMethod ?? defaultPlanMethod(kind);
  const firstDueAt = new Date(dto.firstDueAt);
  if (Number.isNaN(firstDueAt.getTime())) {
    throw new BadRequestException({
      message: 'firstDueAt is not a valid ISO 8601 datetime',
      errorCode: TRANSACTION_ERRORS.TRANSACTION_PLAN_INVALID,
    });
  }
  try {
    const rows = calculateAmortization({
      principalCents,
      interestRate: dto.interestRate,
      transactionsCount: dto.transactionsCount,
      method,
      firstDueAt,
      frequency: dto.frequency,
    });
    return { method, firstDueAt, rows };
  } catch (err) {
    if (err instanceof RangeError) {
      throw new BadRequestException({
        message: err.message,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_PLAN_INVALID,
      });
    }
    throw err;
  }
}

/** Shape of the freshly-inserted parent row the create hook needs. */
export interface PlanParentRow {
  id: string;
  direction: string;
  amountCents: number;
  currency: string;
  categoryId: string;
  createdById: string;
  attributions: { scopeType: string; userId: string | null; groupId: string | null }[];
}

/**
 * Create the `TransactionPlan` row + the N pre-generated child occurrences
 * (status `PENDING`, attributions cloned from the parent, deterministic
 * `idempotencyKey = plan:<planId>:<index>` mirroring the 6.17.3 worker
 * convention). MUST run inside the caller's transaction.
 * Returns the created plan id.
 */
export async function createPlanWithinTransaction(
  tx: Prisma.TransactionClient,
  parent: PlanParentRow,
  kind: TransactionPlanKind,
  dto: CreatePlanDto,
  computed: ComputedPlan,
): Promise<string> {
  const plan = await tx.transactionPlan.create({
    data: {
      transactionId: parent.id,
      kind,
      principalCents: parent.amountCents,
      interestRate: new Prisma.Decimal(dto.interestRate),
      transactionsCount: dto.transactionsCount,
      frequency: dto.frequency,
      firstDueAt: computed.firstDueAt,
      amortizationMethod: computed.method,
    },
  });

  // createMany cannot create nested attributions, so children + attribution
  // clones insert per row — bounded by PLAN_TRANSACTIONS_COUNT_MAX and inside
  // one transaction.
  for (const row of computed.rows) {
    await tx.transaction.create({
      data: {
        direction: parent.direction,
        type: 'ONE_TIME',
        amountCents: row.totalCents,
        currency: parent.currency,
        occurredAt: row.dueAt,
        status: 'PENDING',
        categoryId: parent.categoryId,
        parentTransactionId: parent.id,
        note: null,
        createdById: parent.createdById,
        idempotencyKey: `plan:${plan.id}:${row.index}`,
        attributions: {
          create: parent.attributions.map((a) => ({
            scopeType: a.scopeType,
            userId: a.userId,
            groupId: a.groupId,
          })),
        },
      },
    });
  }

  return plan.id;
}
