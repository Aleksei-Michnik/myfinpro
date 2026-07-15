import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSACTION_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import {
  buildSchedulerId,
  TRANSACTION_OCCURRENCE_JOB,
  TransactionScheduleService,
} from './transaction-schedule.service';
import { TransactionService } from './transaction.service';

describe('TransactionScheduleService', () => {
  let service: TransactionScheduleService;
  let prisma: {
    transaction: { findUnique: jest.Mock };
    transactionSchedule: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
    };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let transactionService: { assertVisible: jest.Mock };
  let queue: {
    upsertJobScheduler: jest.Mock;
    removeJobScheduler: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };

  const userId = 'user-1';
  const transactionId = 'transaction-1';
  const scheduleId = 'schedule-1';

  beforeEach(async () => {
    prisma = {
      transaction: { findUnique: jest.fn() },
      transactionSchedule: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          transactionSchedule: prisma.transactionSchedule,
          auditLog: prisma.auditLog,
        }),
      ),
    } as unknown as typeof prisma;
    transactionService = { assertVisible: jest.fn().mockResolvedValue(undefined) };
    queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue({}),
      removeJobScheduler: jest.fn().mockResolvedValue(true),
    };
    eventBus = { publish: jest.fn() };

    // Default parent transaction for `publishScheduleEvent` lookups; individual
    // tests can override `prisma.transaction.findUnique` if needed.
    prisma.transaction.findUnique.mockImplementation(async () => ({
      id: transactionId,
      type: 'RECURRING',
      createdById: userId,
      attributions: [{ scopeType: 'personal', userId, groupId: null }],
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionScheduleService,
        { provide: PrismaService, useValue: prisma },
        { provide: TransactionService, useValue: transactionService },
        { provide: getQueueToken(TRANSACTION_OCCURRENCES_QUEUE), useValue: queue },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();
    service = module.get(TransactionScheduleService);
  });

  function rowFor(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: scheduleId,
      transactionId,
      cron: null,
      everyMs: 60_000,
      startsAt: new Date('2026-05-15T00:00:00Z'),
      endsAt: null,
      limit: null,
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      cancelledAt: null,
      createdAt: new Date('2026-05-15T00:00:00Z'),
      updatedAt: new Date('2026-05-15T00:00:00Z'),
      ...over,
    };
  }

  describe('create', () => {
    const dto: CreateScheduleDto = { everyMs: 60_000 };

    it('happy path: persists row, upserts scheduler with right args, writes audit log', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: transactionId, type: 'RECURRING' });
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      prisma.transactionSchedule.create.mockResolvedValue(rowFor());

      const out = await service.create(userId, transactionId, dto);

      expect(transactionService.assertVisible).toHaveBeenCalledWith(userId, transactionId);
      expect(prisma.transactionSchedule.create).toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        buildSchedulerId(scheduleId),
        { every: 60_000 },
        expect.objectContaining({
          name: TRANSACTION_OCCURRENCE_JOB,
          data: { scheduleId, transactionId, createdById: userId },
          opts: expect.objectContaining({
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
          }),
        }),
      );
      expect(out.id).toBe(scheduleId);
      // Audit log fired (best-effort).
      await Promise.resolve();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'TRANSACTION_SCHEDULE_CREATED' }),
        }),
      );
    });

    it('rejects with TRANSACTION_SCHEDULE_PARENT_NOT_RECURRING when parent type ≠ RECURRING', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: transactionId, type: 'ONE_TIME' });
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);

      await expect(service.create(userId, transactionId, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.transactionSchedule.create).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('rejects with 409 TRANSACTION_SCHEDULE_ALREADY_EXISTS when a row exists', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: transactionId, type: 'RECURRING' });
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());

      await expect(service.create(userId, transactionId, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.transactionSchedule.create).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('rolls back the DB row when upsertJobScheduler fails twice', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: transactionId, type: 'RECURRING' });
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      prisma.transactionSchedule.create.mockResolvedValue(rowFor());
      prisma.transactionSchedule.delete.mockResolvedValue(rowFor());
      queue.upsertJobScheduler.mockRejectedValue(new Error('redis down'));

      await expect(service.create(userId, transactionId, dto)).rejects.toThrow('redis down');
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2); // initial + retry
      expect(prisma.transactionSchedule.delete).toHaveBeenCalledWith({ where: { id: scheduleId } });
    });

    it('forwards visibility 404 from TransactionService.assertVisible', async () => {
      transactionService.assertVisible.mockRejectedValue(new NotFoundException('hidden'));
      await expect(service.create(userId, transactionId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('replace', () => {
    const dto: CreateScheduleDto = { cron: '0 9 * * *' };

    it('upserts when row absent (create path)', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: transactionId, type: 'RECURRING' });
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      prisma.transactionSchedule.upsert.mockResolvedValue(
        rowFor({ cron: '0 9 * * *', everyMs: null }),
      );

      const out = await service.replace(userId, transactionId, dto);

      expect(prisma.transactionSchedule.upsert).toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        buildSchedulerId(scheduleId),
        { pattern: '0 9 * * *' },
        expect.any(Object),
      );
      expect(out.cron).toBe('0 9 * * *');
    });

    it('upserts when row exists (update path)', async () => {
      prisma.transaction.findUnique.mockResolvedValue({ id: transactionId, type: 'RECURRING' });
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.upsert.mockResolvedValue(
        rowFor({ cron: '0 9 * * *', everyMs: null }),
      );

      await service.replace(userId, transactionId, dto);

      expect(prisma.transactionSchedule.upsert).toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('deletes the row + scheduler', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.delete.mockResolvedValue(rowFor());

      await service.remove(userId, transactionId);

      expect(prisma.transactionSchedule.delete).toHaveBeenCalledWith({ where: { id: scheduleId } });
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(buildSchedulerId(scheduleId));
    });

    it('returns 404 when no schedule exists', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      await expect(service.remove(userId, transactionId)).rejects.toBeInstanceOf(NotFoundException);
      expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    });

    it('swallows queue removal failures (DB row is the source of truth)', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.delete.mockResolvedValue(rowFor());
      queue.removeJobScheduler.mockRejectedValue(new Error('redis flaky'));

      await expect(service.remove(userId, transactionId)).resolves.toBeUndefined();
      expect(prisma.transactionSchedule.delete).toHaveBeenCalled();
    });
  });

  describe('pause()', () => {
    it('happy path: sets pausedAt, removes scheduler, writes audit', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.update.mockResolvedValue(rowFor({ pausedAt: new Date() }));

      const out = await service.pause(userId, transactionId);

      expect(prisma.transactionSchedule.update).toHaveBeenCalledWith({
        where: { id: scheduleId },
        data: expect.objectContaining({ pausedAt: expect.any(Date) }),
      });
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(buildSchedulerId(scheduleId));
      expect(out.pausedAt).not.toBeNull();
      await Promise.resolve();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'TRANSACTION_SCHEDULE_PAUSED' }),
        }),
      );
    });

    it('rejects 409 ALREADY_PAUSED when pausedAt is already set', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor({ pausedAt: new Date() }));
      await expect(service.pause(userId, transactionId)).rejects.toBeInstanceOf(ConflictException);
      expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    });

    it('rejects 409 CANCELLED when schedule is in terminal state', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor({ cancelledAt: new Date() }));
      await expect(service.pause(userId, transactionId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects 404 when no schedule exists', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      await expect(service.pause(userId, transactionId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forwards 404 when parent transaction is invisible', async () => {
      transactionService.assertVisible.mockRejectedValue(new NotFoundException('hidden'));
      await expect(service.pause(userId, transactionId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resume()', () => {
    it('happy path: clears pausedAt, re-upserts scheduler, recomputes nextRunAt, audit', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor({ pausedAt: new Date() }));
      prisma.transactionSchedule.update.mockResolvedValue(rowFor({ pausedAt: null }));

      const out = await service.resume(userId, transactionId);

      expect(prisma.transactionSchedule.update).toHaveBeenCalledWith({
        where: { id: scheduleId },
        data: expect.objectContaining({ pausedAt: null, nextRunAt: expect.any(Date) }),
      });
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        buildSchedulerId(scheduleId),
        { every: 60_000 },
        expect.objectContaining({ name: TRANSACTION_OCCURRENCE_JOB }),
      );
      expect(out.pausedAt).toBeNull();
      await Promise.resolve();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'TRANSACTION_SCHEDULE_RESUMED' }),
        }),
      );
    });

    it('rejects 409 NOT_PAUSED when schedule is active', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      await expect(service.resume(userId, transactionId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects 409 CANCELLED when terminal', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(
        rowFor({ pausedAt: new Date(), cancelledAt: new Date() }),
      );
      await expect(service.resume(userId, transactionId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects 409 PAST_END when endsAt is past', async () => {
      const past = new Date(Date.now() - 60_000);
      prisma.transactionSchedule.findUnique.mockResolvedValue(
        rowFor({ pausedAt: new Date(), endsAt: past }),
      );
      await expect(service.resume(userId, transactionId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects 404 when no schedule', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      await expect(service.resume(userId, transactionId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cancel()', () => {
    it('happy path: sets cancelledAt, removes scheduler, audit', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.update.mockResolvedValue(rowFor({ cancelledAt: new Date() }));

      const out = await service.cancel(userId, transactionId);

      expect(prisma.transactionSchedule.update).toHaveBeenCalledWith({
        where: { id: scheduleId },
        data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
      });
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(buildSchedulerId(scheduleId));
      expect(out.cancelledAt).not.toBeNull();
      await Promise.resolve();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'TRANSACTION_SCHEDULE_CANCELLED' }),
        }),
      );
    });

    it('rejects 409 ALREADY_CANCELLED when already cancelled', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor({ cancelledAt: new Date() }));
      await expect(service.cancel(userId, transactionId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('cancel from paused state succeeds (cancel supersedes pause)', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor({ pausedAt: new Date() }));
      prisma.transactionSchedule.update.mockResolvedValue(
        rowFor({ pausedAt: new Date(), cancelledAt: new Date() }),
      );

      const out = await service.cancel(userId, transactionId);
      expect(out.cancelledAt).not.toBeNull();
      expect(out.pausedAt).not.toBeNull();
    });

    it('rejects 404 when no schedule', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      await expect(service.cancel(userId, transactionId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('onApplicationBootstrap — scheduler reconciliation (8.20)', () => {
    it('re-upserts a job scheduler for every live schedule from the DB', async () => {
      prisma.transactionSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          cron: '0 9 * * *',
          everyMs: null,
          startsAt: new Date('2026-07-01T00:00:00Z'),
          endsAt: null,
          limit: null,
          transaction: { id: transactionId, createdById: userId },
        },
      ]);

      await service.onApplicationBootstrap();

      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'transaction-schedule:sched-1',
        expect.objectContaining({ pattern: '0 9 * * *' }),
        expect.objectContaining({
          data: { scheduleId: 'sched-1', transactionId, createdById: userId },
        }),
      );
      // Only live schedules are loaded: not cancelled, not paused, not past end.
      const where = prisma.transactionSchedule.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ cancelledAt: null, pausedAt: null });
    });

    it('never blocks boot: per-row and query failures are logged, not thrown', async () => {
      prisma.transactionSchedule.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });
  });

  describe('dtoToRepeatOpts (cross-field invariants)', () => {
    it('rejects when both cron and everyMs are present', () => {
      expect(() => service.dtoToRepeatOpts({ cron: '* * * * *', everyMs: 60_000 })).toThrow(
        BadRequestException,
      );
    });

    it('rejects when neither is present', () => {
      expect(() => service.dtoToRepeatOpts({})).toThrow(BadRequestException);
    });

    it('rejects when everyMs < 60_000', () => {
      expect(() => service.dtoToRepeatOpts({ everyMs: 1_000 })).toThrow(BadRequestException);
    });

    it('rejects when endsAt <= startsAt', () => {
      expect(() =>
        service.dtoToRepeatOpts({
          everyMs: 60_000,
          startsAt: '2026-05-15T00:00:00Z',
          endsAt: '2026-05-14T00:00:00Z',
        }),
      ).toThrow(BadRequestException);
    });

    it('translates cron + endsAt + limit', () => {
      const opts = service.dtoToRepeatOpts({
        cron: '0 9 * * *',
        endsAt: '2027-01-01T00:00:00Z',
        limit: 5,
      });
      expect(opts).toMatchObject({ pattern: '0 9 * * *', limit: 5 });
      expect((opts as { endDate: Date }).endDate).toBeInstanceOf(Date);
    });
  });

  describe('realtime EventBus emission', () => {
    // The default mock-impl already returns a fully shaped parent transaction so
    // `computeTransactionRecipients` resolves to `[userId]`.

    it('create emits schedule.created with userIds + schedule payload', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      prisma.transactionSchedule.create.mockResolvedValue(rowFor());

      await service.create(userId, transactionId, { everyMs: 60_000 });

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schedule.created',
          transactionId,
          userIds: [userId],
          schedule: expect.objectContaining({ id: scheduleId, transactionId }),
        }),
      );
    });

    it('replace emits schedule.updated when row already exists', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.upsert.mockResolvedValue(
        rowFor({ cron: '0 9 * * *', everyMs: null }),
      );

      await service.replace(userId, transactionId, { cron: '0 9 * * *' });

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'schedule.updated', transactionId, userIds: [userId] }),
      );
    });

    it('replace emits schedule.created when no prior row existed', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      prisma.transactionSchedule.upsert.mockResolvedValue(
        rowFor({ cron: '0 9 * * *', everyMs: null }),
      );

      await service.replace(userId, transactionId, { cron: '0 9 * * *' });

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'schedule.created', transactionId, userIds: [userId] }),
      );
    });

    it('pause emits schedule.paused', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.update.mockResolvedValue(rowFor({ pausedAt: new Date() }));

      await service.pause(userId, transactionId);

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'schedule.paused', transactionId, userIds: [userId] }),
      );
    });

    it('resume emits schedule.resumed', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor({ pausedAt: new Date() }));
      prisma.transactionSchedule.update.mockResolvedValue(rowFor({ pausedAt: null }));

      await service.resume(userId, transactionId);

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'schedule.resumed', transactionId, userIds: [userId] }),
      );
    });

    it('cancel emits schedule.cancelled', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.update.mockResolvedValue(rowFor({ cancelledAt: new Date() }));

      await service.cancel(userId, transactionId);

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'schedule.cancelled', transactionId, userIds: [userId] }),
      );
    });

    it('remove emits schedule.deleted with no schedule payload', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.transactionSchedule.delete.mockResolvedValue(rowFor());

      await service.remove(userId, transactionId);

      expect(eventBus.publish).toHaveBeenCalledWith({
        type: 'schedule.deleted',
        transactionId,
        userIds: [userId],
      });
    });

    it('publish failures are swallowed and never break the user-facing op', async () => {
      eventBus.publish.mockImplementation(() => {
        throw new Error('bus down');
      });
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      prisma.transactionSchedule.create.mockResolvedValue(rowFor());

      await expect(
        service.create(userId, transactionId, { everyMs: 60_000 }),
      ).resolves.toBeDefined();
    });

    it('does NOT emit when the lifecycle op throws (validation rejects)', async () => {
      prisma.transactionSchedule.findUnique.mockResolvedValue(null);
      // Force the parent-recurring guard to fail.
      prisma.transaction.findUnique.mockResolvedValueOnce({ id: transactionId, type: 'ONE_TIME' });

      await expect(
        service.create(userId, transactionId, { everyMs: 60_000 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });
});
