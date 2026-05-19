import { buildSchedulerId, removeScheduleForPayment } from './schedule-cascade';

describe('removeScheduleForPayment', () => {
  let prisma: {
    paymentSchedule: { findUnique: jest.Mock; delete: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let queue: { removeJobScheduler: jest.Mock };

  beforeEach(() => {
    prisma = {
      paymentSchedule: {
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    queue = { removeJobScheduler: jest.fn().mockResolvedValue(true) };
  });

  it('no-op (returns { removed: false }) when no schedule exists for the payment', async () => {
    prisma.paymentSchedule.findUnique.mockResolvedValue(null);
    const result = await removeScheduleForPayment(prisma as never, queue as never, 'payment-1');
    expect(result).toEqual({ removed: false, scheduleId: null });
    expect(prisma.paymentSchedule.delete).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('happy path: deletes the row, removes the scheduler key, writes the audit log', async () => {
    prisma.paymentSchedule.findUnique.mockResolvedValue({ id: 'sched-1', paymentId: 'payment-1' });
    const result = await removeScheduleForPayment(prisma as never, queue as never, 'payment-1', {
      reason: 'parent_type_changed',
      actorId: 'user-1',
    });
    expect(result).toEqual({ removed: true, scheduleId: 'sched-1' });
    expect(prisma.paymentSchedule.delete).toHaveBeenCalledWith({ where: { id: 'sched-1' } });
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(buildSchedulerId('sched-1'));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAYMENT_SCHEDULE_DELETED',
          entity: 'PaymentSchedule',
          entityId: 'payment-1',
          userId: 'user-1',
          details: expect.objectContaining({
            scheduleId: 'sched-1',
            reason: 'parent_type_changed',
          }),
        }),
      }),
    );
  });

  it('uses the supplied transaction client when opts.tx is set', async () => {
    const tx = {
      paymentSchedule: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sched-2', paymentId: 'payment-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await removeScheduleForPayment(prisma as never, queue as never, 'payment-1', {
      tx: tx as never,
    });
    // Default prisma client must NOT have been touched.
    expect(prisma.paymentSchedule.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentSchedule.delete).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    // Tx client carried out the writes.
    expect(tx.paymentSchedule.findUnique).toHaveBeenCalled();
    expect(tx.paymentSchedule.delete).toHaveBeenCalledWith({ where: { id: 'sched-2' } });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('queue failure is swallowed (DB row already gone is the source of truth)', async () => {
    prisma.paymentSchedule.findUnique.mockResolvedValue({ id: 'sched-3', paymentId: 'payment-1' });
    queue.removeJobScheduler.mockRejectedValue(new Error('redis flaky'));
    await expect(
      removeScheduleForPayment(prisma as never, queue as never, 'payment-1'),
    ).resolves.toEqual({ removed: true, scheduleId: 'sched-3' });
  });

  it('audit failure is swallowed (best-effort)', async () => {
    prisma.paymentSchedule.findUnique.mockResolvedValue({ id: 'sched-4', paymentId: 'payment-1' });
    prisma.auditLog.create.mockRejectedValue(new Error('audit down'));
    await expect(
      removeScheduleForPayment(prisma as never, queue as never, 'payment-1'),
    ).resolves.toEqual({ removed: true, scheduleId: 'sched-4' });
  });

  it('omits the reason key from audit details when not provided (soft-cancel parity)', async () => {
    prisma.paymentSchedule.findUnique.mockResolvedValue({ id: 'sched-5', paymentId: 'payment-1' });
    await removeScheduleForPayment(prisma as never, queue as never, 'payment-1');
    const auditArg = prisma.auditLog.create.mock.calls[0][0] as {
      data: { details: Record<string, unknown> };
    };
    expect(auditArg.data.details.reason).toBeUndefined();
    expect(auditArg.data.details.scheduleId).toBe('sched-5');
  });
});

describe('buildSchedulerId', () => {
  it('produces the deterministic key format', () => {
    expect(buildSchedulerId('abc')).toBe('payment-schedule:abc');
  });
});
