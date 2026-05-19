import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JobsOptions, Queue, RepeatOptions } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import {
  CreateScheduleDto,
  CRON_SANITY_REGEX,
  SCHEDULE_EVERY_MS_MIN,
} from './dto/create-schedule.dto';
import { ScheduleResponseDto } from './dto/schedule-response.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { PaymentService } from './payment.service';
import { computeNextRunAt } from './utils/next-run-at';
import { buildSchedulerId, removeScheduleForPayment } from './utils/schedule-cascade';

/**
 * Production minimum interval (1 minute). Overridable via the
 * `PAYMENT_SCHEDULE_MIN_INTERVAL_MS` env var so the integration suite can
 * drop it to ~100 ms without rewriting the service.
 */
function resolveMinIntervalMs(): number {
  const raw = process.env.PAYMENT_SCHEDULE_MIN_INTERVAL_MS;
  if (!raw) return SCHEDULE_EVERY_MS_MIN;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : SCHEDULE_EVERY_MS_MIN;
}

// `buildSchedulerId` lives in [`utils/schedule-cascade.ts`](utils/schedule-cascade.ts:1)
// to keep the cascade helper cycle-free; re-exported here so existing
// imports (test specs, integration suites) keep working.
export { buildSchedulerId };

/**
 * Job name fired by the scheduler. Centralised so the processor (lands in
 * 6.17.3) and producer agree on a single literal.
 */
export const PAYMENT_OCCURRENCE_JOB = 'create-occurrence';

/**
 * Default job options for scheduler-fired occurrence-creation jobs.
 *
 * Iteration 6.17.3 bumps `attempts` to 3 with exponential backoff now that
 * the worker performs real DB writes — transient Prisma / network blips
 * should retry automatically. The unique `idempotencyKey` column on
 * `payments` guards against double-creation across retries.
 */
const SCHEDULER_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
};

/**
 * Phase 6, iteration 6.17.2 — `PaymentSchedule` CRUD service.
 *
 * Owns the DB ↔ BullMQ consistency contract:
 *  - Every write to `payment_schedules` is mirrored into the queue via
 *    `Queue.upsertJobScheduler` under a deterministic id.
 *  - DELETE removes the row + calls `Queue.removeJobScheduler`.
 *  - If the queue call fails after a DB write, we retry once (the id is
 *    deterministic so retry is safe), and on a second failure we roll the
 *    DB write back so the system stays converged.
 *
 * Visibility / parent-payment validation is delegated to
 * [`PaymentService.assertVisible()`](apps/api/src/payment/payment.service.ts:183)
 * to keep the leak-free 404 contract DRY across services.
 */
@Injectable()
export class PaymentScheduleService {
  private readonly logger = new Logger(PaymentScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    @InjectQueue(PAYMENT_OCCURRENCES_QUEUE) private readonly queue: Queue,
  ) {}

  /** POST /payments/:paymentId/schedule */
  async create(
    userId: string,
    paymentId: string,
    dto: CreateScheduleDto,
  ): Promise<ScheduleResponseDto> {
    const repeatOpts = this.dtoToRepeatOpts(dto);

    await this.paymentService.assertVisible(userId, paymentId);
    const parent = await this.assertParentRecurring(paymentId);

    const existing = await this.prisma.paymentSchedule.findUnique({ where: { paymentId } });
    if (existing) {
      throw new ConflictException({
        message: 'Schedule already exists for this payment — use PUT to replace',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_ALREADY_EXISTS,
      });
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    // Pre-populate nextRunAt so a fresh `GET /schedule` returns a useful
    // value before the worker has fired even once. The processor refreshes
    // this on every firing.
    const initialNextRunAt = computeNextRunAt(
      { cron: dto.cron ?? null, everyMs: dto.everyMs ?? null },
      startsAt,
    );

    const created = await this.prisma.paymentSchedule.create({
      data: {
        paymentId: parent.id,
        cron: dto.cron ?? null,
        everyMs: dto.everyMs ?? null,
        startsAt,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        limit: dto.limit ?? null,
        nextRunAt: initialNextRunAt,
      },
    });

    const schedulerId = buildSchedulerId(created.id);
    try {
      await this.upsertSchedulerWithRetry(schedulerId, repeatOpts, {
        scheduleId: created.id,
        paymentId: parent.id,
        createdById: userId,
      });
    } catch (err) {
      // Roll back the DB row so we stay converged.
      await this.prisma.paymentSchedule
        .delete({ where: { id: created.id } })
        .catch((cleanupErr) => {
          this.logger.error(
            `Failed to roll back schedule ${created.id} after queue failure: ${
              (cleanupErr as Error).message
            }`,
          );
        });
      throw err;
    }

    void this.writeAudit(userId, parent.id, 'PAYMENT_SCHEDULE_CREATED', {
      scheduleId: created.id,
      cron: dto.cron ?? null,
      everyMs: dto.everyMs ?? null,
      limit: dto.limit ?? null,
      endsAt: dto.endsAt ?? null,
    });
    this.logger.log(
      `Schedule ${created.id} created for payment ${parent.id} by user ${userId} ` +
        `(${dto.cron ? `cron=${dto.cron}` : `everyMs=${dto.everyMs}`})`,
    );

    return mapScheduleRowToDto(created);
  }

  /** GET /payments/:paymentId/schedule */
  async get(userId: string, paymentId: string): Promise<ScheduleResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);
    const row = await this.prisma.paymentSchedule.findUnique({ where: { paymentId } });
    if (!row) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_FOUND,
      });
    }
    return mapScheduleRowToDto(row);
  }

  /** PUT /payments/:paymentId/schedule (idempotent upsert). */
  async replace(
    userId: string,
    paymentId: string,
    dto: UpdateScheduleDto,
  ): Promise<ScheduleResponseDto> {
    const repeatOpts = this.dtoToRepeatOpts(dto);

    await this.paymentService.assertVisible(userId, paymentId);
    const parent = await this.assertParentRecurring(paymentId);

    const existing = await this.prisma.paymentSchedule.findUnique({ where: { paymentId } });

    const data: Prisma.PaymentScheduleUncheckedCreateInput = {
      paymentId: parent.id,
      cron: dto.cron ?? null,
      everyMs: dto.everyMs ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : (existing?.startsAt ?? new Date()),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      limit: dto.limit ?? null,
    };

    // Pre-populate nextRunAt so the read API returns a useful value
    // immediately after replace. Worker refreshes on each firing.
    const refreshedNextRunAt = computeNextRunAt(
      { cron: data.cron, everyMs: data.everyMs },
      data.startsAt instanceof Date ? data.startsAt : new Date(data.startsAt as string),
    );
    data.nextRunAt = refreshedNextRunAt;

    const row = await this.prisma.paymentSchedule.upsert({
      where: { paymentId },
      create: data,
      update: {
        cron: data.cron,
        everyMs: data.everyMs,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        limit: data.limit,
        nextRunAt: refreshedNextRunAt,
      },
    });

    const schedulerId = buildSchedulerId(row.id);
    try {
      await this.upsertSchedulerWithRetry(schedulerId, repeatOpts, {
        scheduleId: row.id,
        paymentId: parent.id,
        createdById: userId,
      });
    } catch (err) {
      // On replace we cannot trivially "undo" because the previous row may
      // have been overwritten. We propagate the error and leave the DB row
      // — operator alerting via the error log will surface the divergence,
      // and the caller can retry the PUT (idempotent).
      this.logger.error(
        `upsertJobScheduler failed for schedule ${row.id} after DB write — manual reconciliation may be needed: ${(err as Error).message}`,
      );
      throw err;
    }

    void this.writeAudit(userId, parent.id, 'PAYMENT_SCHEDULE_UPDATED', {
      scheduleId: row.id,
      cron: dto.cron ?? null,
      everyMs: dto.everyMs ?? null,
      limit: dto.limit ?? null,
      endsAt: dto.endsAt ?? null,
      created: existing === null,
    });
    this.logger.log(
      `Schedule ${row.id} ${existing ? 'updated' : 'created'} via PUT for payment ${parent.id} by user ${userId}`,
    );

    return mapScheduleRowToDto(row);
  }

  /** DELETE /payments/:paymentId/schedule */
  async remove(userId: string, paymentId: string): Promise<void> {
    await this.paymentService.assertVisible(userId, paymentId);

    const existing = await this.prisma.paymentSchedule.findUnique({ where: { paymentId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_FOUND,
      });
    }

    const schedulerId = buildSchedulerId(existing.id);
    await this.prisma.paymentSchedule.delete({ where: { id: existing.id } });
    try {
      await this.queue.removeJobScheduler(schedulerId);
    } catch (err) {
      // Swallow + log: the DB row is gone (source of truth) and BullMQ will
      // tolerate an orphaned scheduler key (it will fire and the no-op
      // processor will ack). We don't propagate to avoid a 5xx after the
      // intent has already succeeded server-side.
      this.logger.warn(
        `removeJobScheduler(${schedulerId}) failed: ${(err as Error).message} — leaving orphan`,
      );
    }

    void this.writeAudit(userId, paymentId, 'PAYMENT_SCHEDULE_DELETED', {
      scheduleId: existing.id,
    });
    this.logger.log(`Schedule ${existing.id} for payment ${paymentId} deleted by user ${userId}`);
  }

  /**
   * POST /payments/:paymentId/schedule/pause — soft-pause.
   *
   * Sets `pausedAt = NOW()` and removes the BullMQ scheduler entry so no
   * further occurrences fire. The DB row is preserved so resume can re-
   * upsert under the same id with the original spec.
   */
  async pause(userId: string, paymentId: string): Promise<ScheduleResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);

    const existing = await this.prisma.paymentSchedule.findUnique({ where: { paymentId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_FOUND,
      });
    }
    if (existing.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Schedule has been cancelled — terminal state',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_CANCELLED,
      });
    }
    if (existing.pausedAt !== null) {
      throw new ConflictException({
        message: 'Schedule is already paused',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_ALREADY_PAUSED,
      });
    }

    const schedulerId = buildSchedulerId(existing.id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.paymentSchedule.update({
        where: { id: existing.id },
        data: { pausedAt: new Date() },
      });
      // Queue mutation inside the transaction so a Redis failure rolls back
      // the DB write.
      await this.queue.removeJobScheduler(schedulerId);
      return row;
    });

    void this.writeAudit(userId, paymentId, 'PAYMENT_SCHEDULE_PAUSED', {
      scheduleId: existing.id,
    });
    this.logger.log(`Schedule ${existing.id} for payment ${paymentId} paused by user ${userId}`);
    return mapScheduleRowToDto(updated);
  }

  /**
   * POST /payments/:paymentId/schedule/resume — un-pause.
   *
   * Clears `pausedAt`, re-upserts the BullMQ scheduler under the persisted
   * spec, and recomputes `nextRunAt` from "now" so the read API reflects
   * the post-resume firing schedule before the worker fires once.
   */
  async resume(userId: string, paymentId: string): Promise<ScheduleResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);

    const existing = await this.prisma.paymentSchedule.findUnique({ where: { paymentId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_FOUND,
      });
    }
    if (existing.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Schedule has been cancelled — terminal state',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_CANCELLED,
      });
    }
    if (existing.pausedAt === null) {
      throw new ConflictException({
        message: 'Schedule is not paused',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_PAUSED,
      });
    }
    if (existing.endsAt !== null && existing.endsAt.getTime() < Date.now()) {
      throw new ConflictException({
        message: 'Schedule has passed its end date — cannot resume',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_PAST_END,
      });
    }

    const repeatOpts = this.dtoToRepeatOpts({
      cron: existing.cron ?? undefined,
      everyMs: existing.everyMs ?? undefined,
      startsAt: existing.startsAt.toISOString(),
      endsAt: existing.endsAt?.toISOString(),
      limit: existing.limit ?? undefined,
    });

    const schedulerId = buildSchedulerId(existing.id);
    const now = new Date();
    const refreshedNextRunAt = computeNextRunAt(
      { cron: existing.cron, everyMs: existing.everyMs },
      now,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.paymentSchedule.update({
        where: { id: existing.id },
        data: { pausedAt: null, nextRunAt: refreshedNextRunAt },
      });
      await this.upsertSchedulerWithRetry(schedulerId, repeatOpts, {
        scheduleId: existing.id,
        paymentId,
        createdById: userId,
      });
      return row;
    });

    void this.writeAudit(userId, paymentId, 'PAYMENT_SCHEDULE_RESUMED', {
      scheduleId: existing.id,
    });
    this.logger.log(`Schedule ${existing.id} for payment ${paymentId} resumed by user ${userId}`);
    return mapScheduleRowToDto(updated);
  }

  /**
   * POST /payments/:paymentId/schedule/cancel — soft-cancel (terminal).
   *
   * Sets `cancelledAt = NOW()` and removes the BullMQ scheduler. The row is
   * preserved so child occurrences keep their `parentScheduleId` provenance;
   * use DELETE for a hard remove.
   */
  async cancel(userId: string, paymentId: string): Promise<ScheduleResponseDto> {
    await this.paymentService.assertVisible(userId, paymentId);

    const existing = await this.prisma.paymentSchedule.findUnique({ where: { paymentId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_FOUND,
      });
    }
    if (existing.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Schedule is already cancelled',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_ALREADY_CANCELLED,
      });
    }

    const schedulerId = buildSchedulerId(existing.id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.paymentSchedule.update({
        where: { id: existing.id },
        data: { cancelledAt: new Date() },
      });
      await this.queue.removeJobScheduler(schedulerId);
      return row;
    });

    void this.writeAudit(userId, paymentId, 'PAYMENT_SCHEDULE_CANCELLED', {
      scheduleId: existing.id,
    });
    this.logger.log(`Schedule ${existing.id} for payment ${paymentId} cancelled by user ${userId}`);
    return mapScheduleRowToDto(updated);
  }

  // Re-export the cascade helper bound to this service's prisma + queue, so
  // sibling services don't need to import the bare util.
  async removeForPaymentCascade(
    paymentId: string,
    opts?: { reason?: 'parent_type_changed' | 'parent_deleted'; actorId?: string | null },
  ): Promise<void> {
    await removeScheduleForPayment(this.prisma, this.queue, paymentId, opts);
  }

  // ── helpers ──

  /**
   * Translate a DTO into the BullMQ `repeat` argument. Validates the
   * "exactly one of cron / everyMs" invariant and the endsAt > startsAt
   * relationship that DTOs cannot enforce field-locally.
   */
  dtoToRepeatOpts(dto: CreateScheduleDto): RepeatOptions {
    const hasCron = dto.cron !== undefined && dto.cron !== null && dto.cron !== '';
    const hasEvery = dto.everyMs !== undefined && dto.everyMs !== null;
    if (hasCron === hasEvery) {
      throw new BadRequestException({
        message: 'Exactly one of cron / everyMs must be provided',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_INVALID_SPEC,
      });
    }

    if (hasCron && !CRON_SANITY_REGEX.test(dto.cron!)) {
      throw new BadRequestException({
        message: 'cron expression failed validation',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_INVALID_CRON,
      });
    }

    if (hasEvery) {
      const floor = resolveMinIntervalMs();
      if (dto.everyMs! < floor) {
        throw new BadRequestException({
          message: `everyMs must be ≥ ${floor}`,
          errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_INVALID_INTERVAL,
        });
      }
    }

    if (dto.startsAt && dto.endsAt) {
      if (new Date(dto.endsAt).getTime() <= new Date(dto.startsAt).getTime()) {
        throw new BadRequestException({
          message: 'endsAt must be after startsAt',
          errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_INVALID_END_DATE,
        });
      }
    }

    const opts: RepeatOptions = hasCron ? { pattern: dto.cron! } : { every: dto.everyMs! };
    if (dto.endsAt) opts.endDate = new Date(dto.endsAt);
    if (dto.limit !== undefined && dto.limit !== null) opts.limit = dto.limit;
    return opts;
  }

  private async assertParentRecurring(paymentId: string): Promise<{ id: string; type: string }> {
    const parent = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, type: true },
    });
    // If the visibility check passed the row exists; defensive null-check.
    if (!parent) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }
    if (parent.type !== 'RECURRING') {
      throw new ConflictException({
        message: `Schedules can only be attached to RECURRING payments (got ${parent.type})`,
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_PARENT_NOT_RECURRING,
      });
    }
    return parent;
  }

  /**
   * Upsert a job scheduler. Retries once on transient failure — the
   * scheduler id is deterministic so a duplicate-write is not a concern.
   */
  private async upsertSchedulerWithRetry(
    schedulerId: string,
    repeatOpts: RepeatOptions,
    data: { scheduleId: string; paymentId: string; createdById: string },
  ): Promise<void> {
    const jobTemplate = {
      name: PAYMENT_OCCURRENCE_JOB,
      data,
      opts: SCHEDULER_JOB_OPTIONS,
    };

    try {
      await this.queue.upsertJobScheduler(schedulerId, repeatOpts, jobTemplate);
      return;
    } catch (firstErr) {
      this.logger.warn(
        `upsertJobScheduler(${schedulerId}) failed on first attempt — retrying once: ${(firstErr as Error).message}`,
      );
      try {
        await this.queue.upsertJobScheduler(schedulerId, repeatOpts, jobTemplate);
      } catch (secondErr) {
        this.logger.error(
          `upsertJobScheduler(${schedulerId}) failed twice — propagating: ${(secondErr as Error).message}`,
        );
        throw secondErr;
      }
    }
  }

  private async writeAudit(
    userId: string,
    paymentId: string,
    action:
      | 'PAYMENT_SCHEDULE_CREATED'
      | 'PAYMENT_SCHEDULE_UPDATED'
      | 'PAYMENT_SCHEDULE_DELETED'
      | 'PAYMENT_SCHEDULE_PAUSED'
      | 'PAYMENT_SCHEDULE_RESUMED'
      | 'PAYMENT_SCHEDULE_CANCELLED',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'PaymentSchedule',
          entityId: paymentId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${paymentId}: ${(err as Error).message}`,
      );
    }
  }
}

/** Map a `payment_schedules` row to its wire DTO shape. */
export function mapScheduleRowToDto(row: {
  id: string;
  paymentId: string;
  cron: string | null;
  everyMs: number | null;
  startsAt: Date;
  endsAt: Date | null;
  limit: number | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  pausedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ScheduleResponseDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    cron: row.cron,
    everyMs: row.everyMs,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    limit: row.limit,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
