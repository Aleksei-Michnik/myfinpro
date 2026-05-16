import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import {
  buildSchedulerId,
  PAYMENT_OCCURRENCE_JOB,
  PaymentScheduleService,
} from './payment-schedule.service';
import { PaymentService } from './payment.service';

describe('PaymentScheduleService', () => {
  let service: PaymentScheduleService;
  let prisma: {
    payment: { findUnique: jest.Mock };
    paymentSchedule: {
      findUnique: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let paymentService: { assertVisible: jest.Mock };
  let queue: {
    upsertJobScheduler: jest.Mock;
    removeJobScheduler: jest.Mock;
  };

  const userId = 'user-1';
  const paymentId = 'payment-1';
  const scheduleId = 'schedule-1';

  beforeEach(async () => {
    prisma = {
      payment: { findUnique: jest.fn() },
      paymentSchedule: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    paymentService = { assertVisible: jest.fn().mockResolvedValue(undefined) };
    queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue({}),
      removeJobScheduler: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentScheduleService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentService, useValue: paymentService },
        { provide: getQueueToken(PAYMENT_OCCURRENCES_QUEUE), useValue: queue },
      ],
    }).compile();
    service = module.get(PaymentScheduleService);
  });

  function rowFor(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: scheduleId,
      paymentId,
      cron: null,
      everyMs: 60_000,
      startsAt: new Date('2026-05-15T00:00:00Z'),
      endsAt: null,
      limit: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: new Date('2026-05-15T00:00:00Z'),
      updatedAt: new Date('2026-05-15T00:00:00Z'),
      ...over,
    };
  }

  describe('create', () => {
    const dto: CreateScheduleDto = { everyMs: 60_000 };

    it('happy path: persists row, upserts scheduler with right args, writes audit log', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: paymentId, type: 'RECURRING' });
      prisma.paymentSchedule.findUnique.mockResolvedValue(null);
      prisma.paymentSchedule.create.mockResolvedValue(rowFor());

      const out = await service.create(userId, paymentId, dto);

      expect(paymentService.assertVisible).toHaveBeenCalledWith(userId, paymentId);
      expect(prisma.paymentSchedule.create).toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        buildSchedulerId(scheduleId),
        { every: 60_000 },
        expect.objectContaining({
          name: PAYMENT_OCCURRENCE_JOB,
          data: { scheduleId, paymentId, createdById: userId },
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
          data: expect.objectContaining({ action: 'PAYMENT_SCHEDULE_CREATED' }),
        }),
      );
    });

    it('rejects with PAYMENT_SCHEDULE_PARENT_NOT_RECURRING when parent type ≠ RECURRING', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: paymentId, type: 'ONE_TIME' });
      prisma.paymentSchedule.findUnique.mockResolvedValue(null);

      await expect(service.create(userId, paymentId, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.paymentSchedule.create).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('rejects with 409 PAYMENT_SCHEDULE_ALREADY_EXISTS when a row exists', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: paymentId, type: 'RECURRING' });
      prisma.paymentSchedule.findUnique.mockResolvedValue(rowFor());

      await expect(service.create(userId, paymentId, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.paymentSchedule.create).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('rolls back the DB row when upsertJobScheduler fails twice', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: paymentId, type: 'RECURRING' });
      prisma.paymentSchedule.findUnique.mockResolvedValue(null);
      prisma.paymentSchedule.create.mockResolvedValue(rowFor());
      prisma.paymentSchedule.delete.mockResolvedValue(rowFor());
      queue.upsertJobScheduler.mockRejectedValue(new Error('redis down'));

      await expect(service.create(userId, paymentId, dto)).rejects.toThrow('redis down');
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2); // initial + retry
      expect(prisma.paymentSchedule.delete).toHaveBeenCalledWith({ where: { id: scheduleId } });
    });

    it('forwards visibility 404 from PaymentService.assertVisible', async () => {
      paymentService.assertVisible.mockRejectedValue(new NotFoundException('hidden'));
      await expect(service.create(userId, paymentId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('replace', () => {
    const dto: CreateScheduleDto = { cron: '0 9 * * *' };

    it('upserts when row absent (create path)', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: paymentId, type: 'RECURRING' });
      prisma.paymentSchedule.findUnique.mockResolvedValue(null);
      prisma.paymentSchedule.upsert.mockResolvedValue(rowFor({ cron: '0 9 * * *', everyMs: null }));

      const out = await service.replace(userId, paymentId, dto);

      expect(prisma.paymentSchedule.upsert).toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        buildSchedulerId(scheduleId),
        { pattern: '0 9 * * *' },
        expect.any(Object),
      );
      expect(out.cron).toBe('0 9 * * *');
    });

    it('upserts when row exists (update path)', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: paymentId, type: 'RECURRING' });
      prisma.paymentSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.paymentSchedule.upsert.mockResolvedValue(rowFor({ cron: '0 9 * * *', everyMs: null }));

      await service.replace(userId, paymentId, dto);

      expect(prisma.paymentSchedule.upsert).toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('deletes the row + scheduler', async () => {
      prisma.paymentSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.paymentSchedule.delete.mockResolvedValue(rowFor());

      await service.remove(userId, paymentId);

      expect(prisma.paymentSchedule.delete).toHaveBeenCalledWith({ where: { id: scheduleId } });
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(buildSchedulerId(scheduleId));
    });

    it('returns 404 when no schedule exists', async () => {
      prisma.paymentSchedule.findUnique.mockResolvedValue(null);
      await expect(service.remove(userId, paymentId)).rejects.toBeInstanceOf(NotFoundException);
      expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    });

    it('swallows queue removal failures (DB row is the source of truth)', async () => {
      prisma.paymentSchedule.findUnique.mockResolvedValue(rowFor());
      prisma.paymentSchedule.delete.mockResolvedValue(rowFor());
      queue.removeJobScheduler.mockRejectedValue(new Error('redis flaky'));

      await expect(service.remove(userId, paymentId)).resolves.toBeUndefined();
      expect(prisma.paymentSchedule.delete).toHaveBeenCalled();
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
});
