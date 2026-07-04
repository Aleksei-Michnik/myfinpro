import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { buildSchedulerId } from './payment-schedule.service';
import {
  mapPaymentToSummary,
  PAYMENT_DETAIL_INCLUDE,
  type PaymentWithRelations,
} from './payment.service';
import { computeNextRunAt } from './utils/next-run-at';
import { computePaymentRecipients } from './utils/payment-event-recipients';

/**
 * Job-data contract written by the producer in
 * [`PaymentScheduleService`](./payment-schedule.service.ts:1).
 */
type OccurrenceJobData = {
  scheduleId: string;
  paymentId: string;
  createdById: string;
};

/** Return shape persisted by BullMQ as the job's result. */
type ProcessOutcome =
  | { created: true; occurrenceId: string; firedAt: string }
  | { created: false; reason: string; firedAt: string };

/**
 * Phase 6, iteration 6.17.3 — real occurrence-creation worker.
 *
 * Decision tree (skip-don't-throw on normal eventual-consistency edges):
 *
 * 1. Resolve `PaymentSchedule` + parent `Payment`.
 * 2. Schedule cancelled (`cancelledAt`) or paused (`pausedAt`) → skip,
 *    success. (Lifecycle behaviour lands in 6.17.4; columns ship here.)
 * 3. Parent `Payment` no longer exists → log `[orphan]`, call
 *    `Queue.removeJobScheduler` to self-heal, return success.
 * 4. Parent `Payment` no longer `RECURRING` → same self-heal, return
 *    success.
 * 5. Compute deterministic `idempotencyKey = ${scheduleId}:${firedMs}`.
 * 6. Inside a single `$transaction`:
 *      a. INSERT child Payment with type=ONE_TIME, parentPaymentId, the
 *         parent's economic shape, and `idempotencyKey`.
 *      b. CLONE every parent attribution.
 *      c. UPDATE schedule.lastRunAt + nextRunAt (locally computed).
 * 7. Catch the unique-constraint violation on `idempotencyKey` (P2002) —
 *    BullMQ re-fired the same logical fire-time → log `[duplicate]`,
 *    fetch + return existing occurrenceId.
 * 8. Best-effort `PAYMENT_OCCURRENCE_CREATED` audit log.
 * 9. Unrecoverable errors propagate; BullMQ retries via the `attempts: 3`
 *    + exponential-backoff job opts written by the producer.
 */
@Processor(PAYMENT_OCCURRENCES_QUEUE)
export class PaymentOccurrenceProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentOccurrenceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(PAYMENT_OCCURRENCES_QUEUE) private readonly queue: Queue,
    private readonly eventBus: EventBus,
  ) {
    super();
  }

  async process(job: Job<OccurrenceJobData>): Promise<ProcessOutcome> {
    const { scheduleId, paymentId } = job.data;

    // 1. firedAt — round to the second so a re-fired clone (same logical
    //    fire-time, slightly different processedOn) hits the same key.
    const firedMs = Math.floor((job.processedOn ?? Date.now()) / 1000) * 1000;
    const firedAt = new Date(firedMs);
    const firedAtIso = firedAt.toISOString();

    // 2. Resolve schedule + parent in one read.
    const schedule = await this.prisma.paymentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        payment: {
          include: { attributions: true },
        },
      },
    });

    if (!schedule) {
      // Schedule row vanished (probably a race with DELETE) — best to also
      // remove the BullMQ scheduler so we don't keep firing into the void.
      this.logger.warn(
        `[orphan] schedule ${scheduleId} not found, removing scheduler at ${firedAtIso}`,
      );
      await this.safeRemoveJobScheduler(scheduleId);
      return { created: false, reason: 'schedule_missing', firedAt: firedAtIso };
    }

    // 3. Cancelled / paused — skip without creating.
    if (schedule.cancelledAt !== null) {
      this.logger.log(
        `[skipped] schedule ${scheduleId} cancelled at ${schedule.cancelledAt.toISOString()}, no occurrence at ${firedAtIso}`,
      );
      return { created: false, reason: 'schedule_cancelled', firedAt: firedAtIso };
    }
    if (schedule.pausedAt !== null) {
      this.logger.log(
        `[skipped] schedule ${scheduleId} paused at ${schedule.pausedAt.toISOString()}, no occurrence at ${firedAtIso}`,
      );
      return { created: false, reason: 'schedule_paused', firedAt: firedAtIso };
    }

    // 4. Missing parent — self-heal.
    const parent = schedule.payment;
    if (!parent) {
      this.logger.warn(
        `[orphan] schedule ${scheduleId} has no parent payment ${paymentId}, removing scheduler`,
      );
      await this.safeRemoveJobScheduler(scheduleId);
      return { created: false, reason: 'parent_missing', firedAt: firedAtIso };
    }

    // 5. Parent type changed → self-heal.
    if (parent.type !== 'RECURRING') {
      this.logger.warn(
        `[skipped] parent ${parent.id} is no longer RECURRING (type=${parent.type}), removing scheduler ${scheduleId}`,
      );
      await this.safeRemoveJobScheduler(scheduleId);
      return { created: false, reason: 'parent_not_recurring', firedAt: firedAtIso };
    }

    // 6. Build idempotency key.
    const idempotencyKey = `${scheduleId}:${firedMs}`;
    const nextRunAt = computeNextRunAt({ cron: schedule.cron, everyMs: schedule.everyMs }, firedAt);

    // 7. Insert + clone + schedule update in one transaction. The unique
    //    index on `idempotencyKey` is the fence against double-creation.
    let occurrenceId: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const child = await tx.payment.create({
          data: {
            direction: parent.direction,
            type: 'ONE_TIME',
            amountCents: parent.amountCents,
            currency: parent.currency,
            occurredAt: firedAt,
            status: 'POSTED',
            categoryId: parent.categoryId,
            parentPaymentId: parent.id,
            note: parent.note,
            createdById: parent.createdById,
            idempotencyKey,
            attributions: {
              create: parent.attributions.map((a) => ({
                scopeType: a.scopeType,
                userId: a.userId,
                groupId: a.groupId,
              })),
            },
          },
        });

        await tx.paymentSchedule.update({
          where: { id: scheduleId },
          data: {
            lastRunAt: firedAt,
            nextRunAt,
          },
        });

        return child;
      });
      occurrenceId = result.id;
    } catch (err) {
      // Unique-constraint collision on idempotencyKey → duplicate fire.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray(err.meta?.target)
          ? (err.meta?.target as string[]).some((t) => t.toLowerCase().includes('idempotency'))
          : true
      ) {
        const existing = await this.prisma.payment.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          this.logger.log(
            `[duplicate] occurrence already exists for schedule ${scheduleId} at ${firedAtIso} (occurrenceId=${existing.id})`,
          );
          return { created: false, reason: 'duplicate', firedAt: firedAtIso };
        }
      }
      throw err;
    }

    this.logger.log(
      `Created occurrence ${occurrenceId} for schedule ${scheduleId} (parent ${parent.id}) at ${firedAtIso}`,
    );

    // 8. Best-effort audit.
    void this.writeAudit(parent.createdById, parent.id, {
      scheduleId,
      parentId: parent.id,
      occurrenceId,
      firedAt: firedAtIso,
    });

    // 9. Realtime fan-out — POST commit. Emit `occurrence.created` to the
    // same set of users who have visibility on the parent (which by
    // definition matches the new child since attributions were cloned).
    // Best-effort: failures must never break the worker — the row is
    // already persisted and the next page-load will catch up.
    try {
      const childWithRelations = await this.prisma.payment.findUnique({
        where: { id: occurrenceId },
        include: {
          category: PAYMENT_DETAIL_INCLUDE.category,
          attributions: PAYMENT_DETAIL_INCLUDE.attributions,
        },
      });
      if (childWithRelations) {
        const summary = mapPaymentToSummary(childWithRelations as unknown as PaymentWithRelations, {
          starredByMe: false,
        });
        const recipients = await computePaymentRecipients(
          this.prisma,
          parent.attributions.map((a) => ({
            scopeType: a.scopeType,
            userId: a.userId,
            groupId: a.groupId,
          })),
          parent.createdById,
        );
        this.eventBus.publish({
          type: 'occurrence.created',
          userIds: recipients,
          parentPaymentId: parent.id,
          payment: summary,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to publish occurrence.created for ${occurrenceId}: ${(err as Error).message}`,
      );
    }

    return { created: true, occurrenceId, firedAt: firedAtIso };
  }

  /**
   * Best-effort `Queue.removeJobScheduler` — never throws. If BullMQ refuses
   * (transient Redis blip) we just leave the scheduler key in place; the
   * next firing will retry the same self-heal.
   */
  private async safeRemoveJobScheduler(scheduleId: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(buildSchedulerId(scheduleId));
    } catch (err) {
      this.logger.warn(
        `removeJobScheduler(${buildSchedulerId(scheduleId)}) failed during self-heal: ${
          (err as Error).message
        }`,
      );
    }
  }

  private async writeAudit(
    userId: string,
    paymentId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: PAYMENT_ERRORS.PAYMENT_OCCURRENCE_CREATED,
          entity: 'Payment',
          entityId: paymentId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write PAYMENT_OCCURRENCE_CREATED audit log for payment ${paymentId}: ${
          (err as Error).message
        }`,
      );
    }
  }
}
