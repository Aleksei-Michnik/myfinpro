import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JobsOptions, Queue, RepeatOptions } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSACTION_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { TRANSACTION_ERRORS } from './constants/transaction-errors';
import {
  CreateScheduleDto,
  CRON_SANITY_REGEX,
  SCHEDULE_EVERY_MS_MIN,
} from './dto/create-schedule.dto';
import { ScheduleResponseDto } from './dto/schedule-response.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { TransactionService } from './transaction.service';
import { computeNextRunAt } from './utils/next-run-at';
import { buildSchedulerId, removeScheduleForTransaction } from './utils/schedule-cascade';
import {
  computeTransactionRecipients,
  type RecipientAttribution,
} from './utils/transaction-event-recipients';

/**
 * Production minimum interval (1 minute). Overridable via the
 * `TRANSACTION_SCHEDULE_MIN_INTERVAL_MS` env var so the integration suite can
 * drop it to ~100 ms without rewriting the service.
 */
function resolveMinIntervalMs(): number {
  const raw = process.env.TRANSACTION_SCHEDULE_MIN_INTERVAL_MS;
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
export const TRANSACTION_OCCURRENCE_JOB = 'create-occurrence';

/**
 * Default job options for scheduler-fired occurrence-creation jobs.
 *
 * Iteration 6.17.3 bumps `attempts` to 3 with exponential backoff now that
 * the worker performs real DB writes — transient Prisma / network blips
 * should retry automatically. The unique `idempotencyKey` column on
 * `transactions` guards against double-creation across retries.
 */
const SCHEDULER_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
};

/**
 * Phase 6, iteration 6.17.2 — `TransactionSchedule` CRUD service.
 *
 * Owns the DB ↔ BullMQ consistency contract:
 *  - Every write to `transaction_schedules` is mirrored into the queue via
 *    `Queue.upsertJobScheduler` under a deterministic id.
 *  - DELETE removes the row + calls `Queue.removeJobScheduler`.
 *  - If the queue call fails after a DB write, we retry once (the id is
 *    deterministic so retry is safe), and on a second failure we roll the
 *    DB write back so the system stays converged.
 *
 * Visibility / parent-transaction validation is delegated to
 * [`TransactionService.assertVisible()`](apps/api/src/transaction/transaction.service.ts:183)
 * to keep the leak-free 404 contract DRY across services.
 */
@Injectable()
export class TransactionScheduleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TransactionScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    @InjectQueue(TRANSACTION_OCCURRENCES_QUEUE) private readonly queue: Queue,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Phase 8.20 — converge Redis to the DB on every boot. BullMQ job
   * schedulers live ONLY in Redis, keyed by queue name: rename the queue
   * (as the Payment → Transaction rename did) or lose Redis, and every
   * recurring transaction would silently stop firing. `upsertJobScheduler`
   * is idempotent, so re-upserting every live schedule is safe and makes
   * the DB the source of truth. Best-effort: failures log loudly but never
   * block the app from starting.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcileSchedulers();
  }

  /**
   * The deploy pipeline boots the new container BEFORE running migrations,
   * so the first attempt can race a schema change (as the 8.20 rename did).
   * On a query-level failure, retry a few times in the background — the
   * timer is unref'd so it never holds the process open.
   */
  private async reconcileSchedulers(attempt = 1): Promise<void> {
    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 30_000;
    try {
      const rows = await this.prisma.transactionSchedule.findMany({
        where: {
          cancelledAt: null,
          pausedAt: null,
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
        include: { transaction: { select: { id: true, createdById: true } } },
      });
      let ok = 0;
      for (const row of rows) {
        try {
          const repeatOpts = this.dtoToRepeatOpts({
            cron: row.cron ?? undefined,
            everyMs: row.everyMs ?? undefined,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt?.toISOString(),
            limit: row.limit ?? undefined,
          });
          await this.upsertSchedulerWithRetry(buildSchedulerId(row.id), repeatOpts, {
            scheduleId: row.id,
            transactionId: row.transaction.id,
            createdById: row.transaction.createdById,
          });
          ok++;
        } catch (err) {
          this.logger.error(
            `Scheduler reconciliation failed for schedule ${row.id}: ${(err as Error).message}`,
          );
        }
      }
      if (rows.length > 0) {
        this.logger.log(`Scheduler reconciliation: ${ok}/${rows.length} live schedules upserted`);
      }
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        this.logger.warn(
          `Scheduler reconciliation attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in ${RETRY_DELAY_MS / 1000}s: ${(err as Error).message}`,
        );
        const timer = setTimeout(() => void this.reconcileSchedulers(attempt + 1), RETRY_DELAY_MS);
        timer.unref?.();
      } else {
        this.logger.error(`Scheduler reconciliation gave up: ${(err as Error).message}`);
      }
    }
  }

  /** POST /transactions/:transactionId/schedule */
  async create(
    userId: string,
    transactionId: string,
    dto: CreateScheduleDto,
  ): Promise<ScheduleResponseDto> {
    const repeatOpts = this.dtoToRepeatOpts(dto);

    await this.transactionService.assertVisible(userId, transactionId);
    const parent = await this.assertParentRecurring(transactionId);

    const existing = await this.prisma.transactionSchedule.findUnique({ where: { transactionId } });
    if (existing) {
      throw new ConflictException({
        message: 'Schedule already exists for this transaction — use PUT to replace',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_ALREADY_EXISTS,
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

    const created = await this.prisma.transactionSchedule.create({
      data: {
        transactionId: parent.id,
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
        transactionId: parent.id,
        createdById: userId,
      });
    } catch (err) {
      // Roll back the DB row so we stay converged.
      await this.prisma.transactionSchedule
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

    void this.writeAudit(userId, parent.id, 'TRANSACTION_SCHEDULE_CREATED', {
      scheduleId: created.id,
      cron: dto.cron ?? null,
      everyMs: dto.everyMs ?? null,
      limit: dto.limit ?? null,
      endsAt: dto.endsAt ?? null,
    });
    this.logger.log(
      `Schedule ${created.id} created for transaction ${parent.id} by user ${userId} ` +
        `(${dto.cron ? `cron=${dto.cron}` : `everyMs=${dto.everyMs}`})`,
    );

    const out = mapScheduleRowToDto(created);
    await this.publishScheduleEvent({
      type: 'schedule.created',
      transactionId: parent.id,
      schedule: out,
    });
    return out;
  }

  /** GET /transactions/:transactionId/schedule */
  async get(userId: string, transactionId: string): Promise<ScheduleResponseDto> {
    await this.transactionService.assertVisible(userId, transactionId);
    const row = await this.prisma.transactionSchedule.findUnique({ where: { transactionId } });
    if (!row) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_NOT_FOUND,
      });
    }
    return mapScheduleRowToDto(row);
  }

  /** PUT /transactions/:transactionId/schedule (idempotent upsert). */
  async replace(
    userId: string,
    transactionId: string,
    dto: UpdateScheduleDto,
  ): Promise<ScheduleResponseDto> {
    const repeatOpts = this.dtoToRepeatOpts(dto);

    await this.transactionService.assertVisible(userId, transactionId);
    const parent = await this.assertParentRecurring(transactionId);

    const existing = await this.prisma.transactionSchedule.findUnique({ where: { transactionId } });

    const data: Prisma.TransactionScheduleUncheckedCreateInput = {
      transactionId: parent.id,
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

    const row = await this.prisma.transactionSchedule.upsert({
      where: { transactionId },
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
        transactionId: parent.id,
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

    void this.writeAudit(userId, parent.id, 'TRANSACTION_SCHEDULE_UPDATED', {
      scheduleId: row.id,
      cron: dto.cron ?? null,
      everyMs: dto.everyMs ?? null,
      limit: dto.limit ?? null,
      endsAt: dto.endsAt ?? null,
      created: existing === null,
    });
    this.logger.log(
      `Schedule ${row.id} ${existing ? 'updated' : 'created'} via PUT for transaction ${parent.id} by user ${userId}`,
    );

    const out = mapScheduleRowToDto(row);
    await this.publishScheduleEvent({
      type: existing ? 'schedule.updated' : 'schedule.created',
      transactionId: parent.id,
      schedule: out,
    });
    return out;
  }

  /** DELETE /transactions/:transactionId/schedule */
  async remove(userId: string, transactionId: string): Promise<void> {
    await this.transactionService.assertVisible(userId, transactionId);

    const existing = await this.prisma.transactionSchedule.findUnique({ where: { transactionId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_NOT_FOUND,
      });
    }

    const schedulerId = buildSchedulerId(existing.id);
    await this.prisma.transactionSchedule.delete({ where: { id: existing.id } });
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

    void this.writeAudit(userId, transactionId, 'TRANSACTION_SCHEDULE_DELETED', {
      scheduleId: existing.id,
    });
    this.logger.log(
      `Schedule ${existing.id} for transaction ${transactionId} deleted by user ${userId}`,
    );

    await this.publishScheduleEvent({ type: 'schedule.deleted', transactionId });
  }

  /**
   * POST /transactions/:transactionId/schedule/pause — soft-pause.
   *
   * Sets `pausedAt = NOW()` and removes the BullMQ scheduler entry so no
   * further occurrences fire. The DB row is preserved so resume can re-
   * upsert under the same id with the original spec.
   */
  async pause(userId: string, transactionId: string): Promise<ScheduleResponseDto> {
    await this.transactionService.assertVisible(userId, transactionId);

    const existing = await this.prisma.transactionSchedule.findUnique({ where: { transactionId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_NOT_FOUND,
      });
    }
    if (existing.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Schedule has been cancelled — terminal state',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_CANCELLED,
      });
    }
    if (existing.pausedAt !== null) {
      throw new ConflictException({
        message: 'Schedule is already paused',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_ALREADY_PAUSED,
      });
    }

    const schedulerId = buildSchedulerId(existing.id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.transactionSchedule.update({
        where: { id: existing.id },
        data: { pausedAt: new Date() },
      });
      // Queue mutation inside the transaction so a Redis failure rolls back
      // the DB write.
      await this.queue.removeJobScheduler(schedulerId);
      return row;
    });

    void this.writeAudit(userId, transactionId, 'TRANSACTION_SCHEDULE_PAUSED', {
      scheduleId: existing.id,
    });
    this.logger.log(
      `Schedule ${existing.id} for transaction ${transactionId} paused by user ${userId}`,
    );
    const out = mapScheduleRowToDto(updated);
    await this.publishScheduleEvent({ type: 'schedule.paused', transactionId, schedule: out });
    return out;
  }

  /**
   * POST /transactions/:transactionId/schedule/resume — un-pause.
   *
   * Clears `pausedAt`, re-upserts the BullMQ scheduler under the persisted
   * spec, and recomputes `nextRunAt` from "now" so the read API reflects
   * the post-resume firing schedule before the worker fires once.
   */
  async resume(userId: string, transactionId: string): Promise<ScheduleResponseDto> {
    await this.transactionService.assertVisible(userId, transactionId);

    const existing = await this.prisma.transactionSchedule.findUnique({ where: { transactionId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_NOT_FOUND,
      });
    }
    if (existing.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Schedule has been cancelled — terminal state',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_CANCELLED,
      });
    }
    if (existing.pausedAt === null) {
      throw new ConflictException({
        message: 'Schedule is not paused',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_NOT_PAUSED,
      });
    }
    if (existing.endsAt !== null && existing.endsAt.getTime() < Date.now()) {
      throw new ConflictException({
        message: 'Schedule has passed its end date — cannot resume',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_PAST_END,
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
      const row = await tx.transactionSchedule.update({
        where: { id: existing.id },
        data: { pausedAt: null, nextRunAt: refreshedNextRunAt },
      });
      await this.upsertSchedulerWithRetry(schedulerId, repeatOpts, {
        scheduleId: existing.id,
        transactionId,
        createdById: userId,
      });
      return row;
    });

    void this.writeAudit(userId, transactionId, 'TRANSACTION_SCHEDULE_RESUMED', {
      scheduleId: existing.id,
    });
    this.logger.log(
      `Schedule ${existing.id} for transaction ${transactionId} resumed by user ${userId}`,
    );
    const out = mapScheduleRowToDto(updated);
    await this.publishScheduleEvent({ type: 'schedule.resumed', transactionId, schedule: out });
    return out;
  }

  /**
   * POST /transactions/:transactionId/schedule/cancel — soft-cancel (terminal).
   *
   * Sets `cancelledAt = NOW()` and removes the BullMQ scheduler. The row is
   * preserved so child occurrences keep their `parentScheduleId` provenance;
   * use DELETE for a hard remove.
   */
  async cancel(userId: string, transactionId: string): Promise<ScheduleResponseDto> {
    await this.transactionService.assertVisible(userId, transactionId);

    const existing = await this.prisma.transactionSchedule.findUnique({ where: { transactionId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Schedule not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_NOT_FOUND,
      });
    }
    if (existing.cancelledAt !== null) {
      throw new ConflictException({
        message: 'Schedule is already cancelled',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_ALREADY_CANCELLED,
      });
    }

    const schedulerId = buildSchedulerId(existing.id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.transactionSchedule.update({
        where: { id: existing.id },
        data: { cancelledAt: new Date() },
      });
      await this.queue.removeJobScheduler(schedulerId);
      return row;
    });

    void this.writeAudit(userId, transactionId, 'TRANSACTION_SCHEDULE_CANCELLED', {
      scheduleId: existing.id,
    });
    this.logger.log(
      `Schedule ${existing.id} for transaction ${transactionId} cancelled by user ${userId}`,
    );
    const out = mapScheduleRowToDto(updated);
    await this.publishScheduleEvent({ type: 'schedule.cancelled', transactionId, schedule: out });
    return out;
  }

  // Re-export the cascade helper bound to this service's prisma + queue, so
  // sibling services don't need to import the bare util.
  async removeForTransactionCascade(
    transactionId: string,
    opts?: { reason?: 'parent_type_changed' | 'parent_deleted'; actorId?: string | null },
  ): Promise<void> {
    await removeScheduleForTransaction(this.prisma, this.queue, transactionId, opts);
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
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_INVALID_SPEC,
      });
    }

    if (hasCron && !CRON_SANITY_REGEX.test(dto.cron!)) {
      throw new BadRequestException({
        message: 'cron expression failed validation',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_INVALID_CRON,
      });
    }

    if (hasEvery) {
      const floor = resolveMinIntervalMs();
      if (dto.everyMs! < floor) {
        throw new BadRequestException({
          message: `everyMs must be ≥ ${floor}`,
          errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_INVALID_INTERVAL,
        });
      }
    }

    if (dto.startsAt && dto.endsAt) {
      if (new Date(dto.endsAt).getTime() <= new Date(dto.startsAt).getTime()) {
        throw new BadRequestException({
          message: 'endsAt must be after startsAt',
          errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_INVALID_END_DATE,
        });
      }
    }

    const opts: RepeatOptions = hasCron ? { pattern: dto.cron! } : { every: dto.everyMs! };
    if (dto.endsAt) opts.endDate = new Date(dto.endsAt);
    if (dto.limit !== undefined && dto.limit !== null) opts.limit = dto.limit;
    return opts;
  }

  private async assertParentRecurring(
    transactionId: string,
  ): Promise<{ id: string; type: string }> {
    const parent = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, type: true },
    });
    // If the visibility check passed the row exists; defensive null-check.
    if (!parent) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }
    if (parent.type !== 'RECURRING') {
      throw new ConflictException({
        message: `Schedules can only be attached to RECURRING transactions (got ${parent.type})`,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_PARENT_NOT_RECURRING,
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
    data: { scheduleId: string; transactionId: string; createdById: string },
  ): Promise<void> {
    const jobTemplate = {
      name: TRANSACTION_OCCURRENCE_JOB,
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
    transactionId: string,
    action:
      | 'TRANSACTION_SCHEDULE_CREATED'
      | 'TRANSACTION_SCHEDULE_UPDATED'
      | 'TRANSACTION_SCHEDULE_DELETED'
      | 'TRANSACTION_SCHEDULE_PAUSED'
      | 'TRANSACTION_SCHEDULE_RESUMED'
      | 'TRANSACTION_SCHEDULE_CANCELLED',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'TransactionSchedule',
          entityId: transactionId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${transactionId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Resolve the multicast recipient list for the schedule's parent transaction
   * and publish on the EventBus. POST-commit, best-effort: a Redis blip
   * never breaks the user-facing schedule operation. Mirrors the pattern in
   * [`TransactionCommentService.publishCommentEvent`](./transaction-comment.service.ts:265).
   */
  private async publishScheduleEvent(
    payload:
      | { type: 'schedule.created'; transactionId: string; schedule: ScheduleResponseDto }
      | { type: 'schedule.updated'; transactionId: string; schedule: ScheduleResponseDto }
      | { type: 'schedule.paused'; transactionId: string; schedule: ScheduleResponseDto }
      | { type: 'schedule.resumed'; transactionId: string; schedule: ScheduleResponseDto }
      | { type: 'schedule.cancelled'; transactionId: string; schedule: ScheduleResponseDto }
      | { type: 'schedule.deleted'; transactionId: string },
  ): Promise<void> {
    try {
      const parent = await this.prisma.transaction.findUnique({
        where: { id: payload.transactionId },
        select: {
          createdById: true,
          attributions: { select: { scopeType: true, userId: true, groupId: true } },
        },
      });
      if (!parent) return;
      const userIds = await computeTransactionRecipients(
        this.prisma,
        parent.attributions as RecipientAttribution[],
        parent.createdById,
      );
      if (payload.type === 'schedule.deleted') {
        this.eventBus.publish({
          type: 'schedule.deleted',
          userIds,
          transactionId: payload.transactionId,
        });
      } else {
        this.eventBus.publish({
          type: payload.type,
          userIds,
          transactionId: payload.transactionId,
          schedule: payload.schedule,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to publish ${payload.type} for transaction ${payload.transactionId}: ${(err as Error).message}`,
      );
    }
  }
}

/** Map a `transaction_schedules` row to its wire DTO shape. */
export function mapScheduleRowToDto(row: {
  id: string;
  transactionId: string;
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
    transactionId: row.transactionId,
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
