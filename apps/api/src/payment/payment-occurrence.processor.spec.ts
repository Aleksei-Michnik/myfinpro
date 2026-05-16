import { Prisma } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentOccurrenceProcessor } from './payment-occurrence.processor';

/**
 * Phase 6, iteration 6.17.3 — unit tests for the real occurrence-creation
 * worker. Every Prisma + Queue interaction is mocked; we only assert the
 * processor's decision tree, its idempotent INSERT path, and the audit
 * write.
 */
describe('PaymentOccurrenceProcessor', () => {
  const SCHEDULE_ID = 'sched-1';
  const PARENT_ID = 'parent-1';
  const CHILD_ID = 'child-1';
  const CREATOR_ID = 'creator-1';
  // 2026-05-16T12:30:00.000Z — round number for cron-parser assertions.
  const FIRED_MS = 1779093000_000;

  function buildJob(overrides: Partial<Job<unknown>> = {}): Job<{
    scheduleId: string;
    paymentId: string;
    createdById: string;
  }> {
    return {
      data: { scheduleId: SCHEDULE_ID, paymentId: PARENT_ID, createdById: CREATOR_ID },
      processedOn: FIRED_MS,
      ...overrides,
    } as Job<{ scheduleId: string; paymentId: string; createdById: string }>;
  }

  function buildSchedule(
    overrides: Partial<{
      cron: string | null;
      everyMs: number | null;
      cancelledAt: Date | null;
      pausedAt: Date | null;
      payment: unknown;
    }> = {},
  ) {
    return {
      id: SCHEDULE_ID,
      paymentId: PARENT_ID,
      cron: null,
      everyMs: 60_000,
      startsAt: new Date(FIRED_MS - 60_000),
      endsAt: null,
      limit: null,
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      payment: buildParent(),
      ...overrides,
    };
  }

  function buildParent(overrides: Partial<{ type: string; attributions: unknown[] }> = {}) {
    return {
      id: PARENT_ID,
      direction: 'OUT',
      type: 'RECURRING',
      amountCents: 4200,
      currency: 'USD',
      occurredAt: new Date(FIRED_MS - 86_400_000),
      status: 'POSTED',
      categoryId: 'cat-1',
      parentPaymentId: null,
      note: 'parent note',
      createdById: CREATOR_ID,
      idempotencyKey: null,
      attributions: [{ id: 'a1', scopeType: 'personal', userId: CREATOR_ID, groupId: null }],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  type Mocks = {
    prisma: jest.Mocked<Pick<PrismaService, '$transaction'>> & Record<string, unknown>;
    queue: jest.Mocked<Pick<Queue, 'removeJobScheduler'>>;
    txCalls: Array<Record<string, unknown>>;
    auditCreate: jest.Mock;
  };

  function buildMocks(): Mocks {
    const auditCreate = jest.fn().mockResolvedValue(undefined);
    const findUniqueSchedule = jest.fn();
    const findUniquePayment = jest.fn();
    const txCalls: Array<Record<string, unknown>> = [];

    const txClient = {
      payment: {
        create: jest.fn().mockResolvedValue({ id: CHILD_ID }),
      },
      paymentSchedule: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const $transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient));

    const prisma = {
      paymentSchedule: { findUnique: findUniqueSchedule },
      payment: { findUnique: findUniquePayment },
      auditLog: { create: auditCreate },
      $transaction,
      _tx: txClient,
    } as unknown as Mocks['prisma'];

    const queue = {
      removeJobScheduler: jest.fn().mockResolvedValue(true),
    } as unknown as Mocks['queue'];

    return { prisma, queue, txCalls, auditCreate };
  }

  function build(mocks: Mocks): PaymentOccurrenceProcessor {
    return new PaymentOccurrenceProcessor(
      mocks.prisma as unknown as PrismaService,
      mocks.queue as unknown as Queue,
    );
  }

  it('happy path — creates child Payment with parent shape, updates schedule, writes audit', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule({ everyMs: 60_000 }),
    );

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result).toEqual({
      created: true,
      occurrenceId: CHILD_ID,
      firedAt: new Date(FIRED_MS).toISOString(),
    });

    const tx = (mocks.prisma as unknown as { _tx: { payment: { create: jest.Mock } } })._tx;
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    const createArg = tx.payment.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      direction: 'OUT',
      type: 'ONE_TIME',
      amountCents: 4200,
      currency: 'USD',
      categoryId: 'cat-1',
      parentPaymentId: PARENT_ID,
      note: 'parent note',
      createdById: CREATOR_ID,
      status: 'POSTED',
      idempotencyKey: `${SCHEDULE_ID}:${FIRED_MS}`,
    });
    expect(createArg.data.occurredAt).toEqual(new Date(FIRED_MS));
    expect(createArg.data.attributions.create).toEqual([
      { scopeType: 'personal', userId: CREATOR_ID, groupId: null },
    ]);

    const schedUpdate = (
      mocks.prisma as unknown as {
        _tx: { paymentSchedule: { update: jest.Mock } };
      }
    )._tx.paymentSchedule.update;
    expect(schedUpdate).toHaveBeenCalledWith({
      where: { id: SCHEDULE_ID },
      data: { lastRunAt: new Date(FIRED_MS), nextRunAt: new Date(FIRED_MS + 60_000) },
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAYMENT_OCCURRENCE_CREATED',
          entity: 'Payment',
          entityId: PARENT_ID,
          userId: CREATOR_ID,
        }),
      }),
    );
  });

  it('clones multiple parent attributions onto the child', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule({
        payment: buildParent({
          attributions: [
            { id: 'a1', scopeType: 'personal', userId: CREATOR_ID, groupId: null },
            { id: 'a2', scopeType: 'group', userId: null, groupId: 'g-1' },
            { id: 'a3', scopeType: 'group', userId: null, groupId: 'g-2' },
          ],
        }),
      }),
    );

    const processor = build(mocks);
    await processor.process(buildJob());

    const tx = (mocks.prisma as unknown as { _tx: { payment: { create: jest.Mock } } })._tx;
    const createArg = tx.payment.create.mock.calls[0][0];
    expect(createArg.data.attributions.create).toEqual([
      { scopeType: 'personal', userId: CREATOR_ID, groupId: null },
      { scopeType: 'group', userId: null, groupId: 'g-1' },
      { scopeType: 'group', userId: null, groupId: 'g-2' },
    ]);
  });

  it('cron schedule — nextRunAt is computed via cron-parser', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule({ cron: '*/15 * * * *', everyMs: null }),
    );

    const processor = build(mocks);
    await processor.process(buildJob());

    const schedUpdate = (
      mocks.prisma as unknown as {
        _tx: { paymentSchedule: { update: jest.Mock } };
      }
    )._tx.paymentSchedule.update;
    const updateArg = schedUpdate.mock.calls[0][0];
    // FIRED_MS is on a 30-minute boundary; the next */15 slot is firedMs + 15min.
    expect(updateArg.data.nextRunAt.toISOString()).toBe(
      new Date(FIRED_MS + 15 * 60 * 1000).toISOString(),
    );
  });

  it('skipped when schedule cancelled', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule({ cancelledAt: new Date(FIRED_MS - 5000) }),
    );

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result).toEqual({
      created: false,
      reason: 'schedule_cancelled',
      firedAt: new Date(FIRED_MS).toISOString(),
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('skipped when schedule paused', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule({ pausedAt: new Date(FIRED_MS - 5000) }),
    );

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result.created).toBe(false);
    if (!result.created) expect(result.reason).toBe('schedule_paused');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('orphan: schedule missing → removeJobScheduler called, no Payment created', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result.created).toBe(false);
    if (!result.created) expect(result.reason).toBe('schedule_missing');
    expect(mocks.queue.removeJobScheduler).toHaveBeenCalledWith(`payment-schedule:${SCHEDULE_ID}`);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('parent type changed to ONE_TIME → removeJobScheduler called, no Payment created', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule({ payment: buildParent({ type: 'ONE_TIME' }) }),
    );

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result.created).toBe(false);
    if (!result.created) expect(result.reason).toBe('parent_not_recurring');
    expect(mocks.queue.removeJobScheduler).toHaveBeenCalledWith(`payment-schedule:${SCHEDULE_ID}`);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('idempotency: duplicate fire → fetches existing occurrenceId and skips insert', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule(),
    );
    // First call fails with P2002 on idempotency_key.
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '0.0.0',
      meta: { target: ['idempotency_key'] },
    });
    (mocks.prisma.$transaction as jest.Mock).mockRejectedValueOnce(p2002);
    (mocks.prisma.payment as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      id: 'existing-occurrence',
    });

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result.created).toBe(false);
    if (!result.created) expect(result.reason).toBe('duplicate');
    expect((mocks.prisma.payment as { findUnique: jest.Mock }).findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: `${SCHEDULE_ID}:${FIRED_MS}` },
      select: { id: true },
    });
  });

  it('non-idempotency Prisma errors propagate (BullMQ retries via attempts opt)', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule(),
    );
    (mocks.prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('connection lost'));

    const processor = build(mocks);
    await expect(processor.process(buildJob())).rejects.toThrow('connection lost');
  });

  it('audit log failure does not break the success result', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule(),
    );
    mocks.auditCreate.mockRejectedValueOnce(new Error('audit table down'));

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result).toEqual(expect.objectContaining({ created: true, occurrenceId: CHILD_ID }));
  });

  it('uses Date.now() when job.processedOn is missing, rounded to the second', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule(),
    );
    const fixedNow = 1700000000_123;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const processor = build(mocks);
    const result = await processor.process(
      buildJob({ processedOn: undefined } as unknown as Job<unknown>),
    );

    const expectedMs = Math.floor(fixedNow / 1000) * 1000;
    if (!result.created) throw new Error('expected creation');
    expect(result.firedAt).toBe(new Date(expectedMs).toISOString());

    (Date.now as jest.Mock).mockRestore();
  });

  it('cancelled takes precedence over parent checks (no removeJobScheduler call)', async () => {
    const mocks = buildMocks();
    (mocks.prisma.paymentSchedule as { findUnique: jest.Mock }).findUnique.mockResolvedValue(
      buildSchedule({ cancelledAt: new Date(), payment: buildParent({ type: 'ONE_TIME' }) }),
    );

    const processor = build(mocks);
    const result = await processor.process(buildJob());

    expect(result.created).toBe(false);
    if (!result.created) expect(result.reason).toBe('schedule_cancelled');
    expect(mocks.queue.removeJobScheduler).not.toHaveBeenCalled();
  });
});
