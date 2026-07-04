import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

const logger = new Logger('schedule-cascade');

/**
 * Build the deterministic BullMQ scheduler id for a `PaymentSchedule` row.
 *
 * Inlined here (rather than re-exported from `PaymentScheduleService`) to
 * keep `utils/schedule-cascade.ts` cycle-free: `PaymentService` consumes
 * this util, and `PaymentScheduleService` also consumes it — both sides
 * must stay leaf-imports. The format is the contract; never change it
 * without a migration.
 */
export function buildSchedulerId(scheduleId: string): string {
  return `payment-schedule:${scheduleId}`;
}

/**
 * Subset of Prisma client surface that both the root client and a transaction
 * client (`Prisma.TransactionClient`) satisfy. Lets `removeScheduleForPayment`
 * accept either without a generic.
 */
export type PrismaClientLike = Pick<PrismaService, 'paymentSchedule' | 'auditLog'>;

export interface RemoveScheduleOpts {
  /**
   * Prisma transaction client. When provided, the DB writes (delete + audit)
   * happen inside the caller's transaction so cascade tear-down rolls back
   * with the surrounding parent-payment edit / delete.
   */
  tx?: Prisma.TransactionClient;
  /**
   * Optional reason persisted in the audit log details. Used to differentiate
   * the soft-cancel endpoint (no reason) from the cascade tear-downs
   * (`'parent_type_changed'` / `'parent_deleted'`).
   */
  reason?: 'parent_type_changed' | 'parent_deleted';
  /** User id attributed on the audit row. Optional — falls back to `null`. */
  actorId?: string | null;
}

export interface RemoveScheduleResult {
  removed: boolean;
  scheduleId: string | null;
}

/**
 * Producer-side cascade tear-down — single chokepoint for removing a
 * `PaymentSchedule` row + its BullMQ scheduler key in one shot.
 *
 * Used by:
 *  - {@link PaymentScheduleService.cancel} indirectly via `removeJobScheduler`
 *    (cancel preserves the row, only this helper deletes the row).
 *  - {@link PaymentService.update} on a RECURRING → other-type transition.
 *  - {@link PaymentService.remove} on the final hard-delete branch.
 *
 * Behavior:
 *  - No row → no-op (`{ removed: false }`).
 *  - Row present → delete the row + `queue.removeJobScheduler(...)` + audit.
 *  - Audit + queue failures are best-effort (logged, never thrown), so the
 *    surrounding parent-payment write never fails on a Redis blip.
 */
export async function removeScheduleForPayment(
  prisma: PrismaClientLike,
  queue: Queue,
  paymentId: string,
  opts: RemoveScheduleOpts = {},
): Promise<RemoveScheduleResult> {
  const db = (opts.tx ?? prisma) as PrismaClientLike;

  const existing = await db.paymentSchedule.findUnique({ where: { paymentId } });
  if (!existing) return { removed: false, scheduleId: null };

  const schedulerId = buildSchedulerId(existing.id);

  await db.paymentSchedule.delete({ where: { id: existing.id } });

  // Best-effort audit log. Participates in `tx` rollback when supplied —
  // outside a tx, audit failure never throws (worker self-heal still
  // covers any divergence the queue writes have).
  try {
    await db.auditLog.create({
      data: {
        userId: opts.actorId ?? null,
        action: 'PAYMENT_SCHEDULE_DELETED',
        entity: 'PaymentSchedule',
        entityId: paymentId,
        details: {
          scheduleId: existing.id,
          ...(opts.reason ? { reason: opts.reason } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.warn(
      `audit log failed for cascade tear-down of schedule ${existing.id} (payment ${paymentId}): ${(err as Error).message}`,
    );
  }

  // Queue mutation: skip when inside a caller-supplied transaction —
  // holding Redis I/O while the SQL tx keeps row locks open invites
  // MySQL deadlocks (observed under integration concurrency). The
  // caller is expected to invoke `removeJobScheduler` post-commit; the
  // returned `scheduleId` lets it reconstruct the deterministic key.
  // Outside a tx (e.g. ad-hoc call), we run the queue write inline.
  if (!opts.tx) {
    try {
      await queue.removeJobScheduler(schedulerId);
    } catch (err) {
      logger.warn(
        `removeJobScheduler(${schedulerId}) failed during cascade tear-down: ${(err as Error).message} — leaving orphan, processor will self-heal`,
      );
    }
  }

  return { removed: true, scheduleId: existing.id };
}
