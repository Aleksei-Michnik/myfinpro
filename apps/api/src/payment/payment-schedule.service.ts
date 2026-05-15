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

/**
 * Build the deterministic BullMQ scheduler id for a `PaymentSchedule` row.
 *
 * Stable for the schedule's lifetime — never reused. Re-upserting under the
 * same id replaces the existing repeatable job entry (BullMQ idempotency
 * contract — see Queue.upsertJobScheduler v5+ docs).
 */
export function buildSchedulerId(scheduleId: string): string {
  return `payment-schedule:${scheduleId}`;
}

/**
 * Job name fired by the scheduler. Centralised so the processor (lands in
 * 6.17.3) and producer agree on a single literal.
 */
export const PAYMENT_OCCURRENCE_JOB = 'create-occurrence';

/**
 * Default job options. `attempts: 1` keeps the no-op processor (6.17.2) from
 * retrying forever during this transition iteration; 6.17.3 will bump this
 * to 3 with exponential backoff once the worker actually creates rows.
 */
const SCHEDULER_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
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

    const created = await this.prisma.paymentSchedule.create({
      data: {
        paymentId: parent.id,
        cron: dto.cron ?? null,
        everyMs: dto.everyMs ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        limit: dto.limit ?? null,
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

    const row = await this.prisma.paymentSchedule.upsert({
      where: { paymentId },
      create: data,
      update: {
        cron: data.cron,
        everyMs: data.everyMs,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        limit: data.limit,
        // Re-upsert clears denormalized scheduler bookkeeping; the worker
        // will repopulate nextRunAt on the first fire.
        nextRunAt: null,
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

    if (hasEvery && dto.everyMs! < SCHEDULE_EVERY_MS_MIN) {
      throw new BadRequestException({
        message: `everyMs must be ≥ ${SCHEDULE_EVERY_MS_MIN}`,
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_INVALID_INTERVAL,
      });
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
    action: 'PAYMENT_SCHEDULE_CREATED' | 'PAYMENT_SCHEDULE_UPDATED' | 'PAYMENT_SCHEDULE_DELETED',
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
