import { Test, TestingModule } from '@nestjs/testing';
import { TransactionScheduleController } from './transaction-schedule.controller';
import { TransactionScheduleService } from './transaction-schedule.service';

describe('TransactionScheduleController', () => {
  let controller: TransactionScheduleController;
  let service: {
    create: jest.Mock;
    get: jest.Mock;
    replace: jest.Mock;
    remove: jest.Mock;
    pause: jest.Mock;
    resume: jest.Mock;
    cancel: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      get: jest.fn(),
      replace: jest.fn(),
      remove: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      cancel: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionScheduleController],
      providers: [{ provide: TransactionScheduleService, useValue: service }],
    }).compile();
    controller = module.get(TransactionScheduleController);
  });

  const user = { sub: 'u1' } as { sub: string };
  const transactionId = 'p1';

  it('POST → service.create', async () => {
    service.create.mockResolvedValue({ id: 's1' });
    const res = await controller.create(user as never, transactionId, { everyMs: 60_000 });
    expect(service.create).toHaveBeenCalledWith('u1', transactionId, { everyMs: 60_000 });
    expect(res).toEqual({ id: 's1' });
  });

  it('GET → service.get', async () => {
    service.get.mockResolvedValue({ id: 's1' });
    const res = await controller.get(user as never, transactionId);
    expect(service.get).toHaveBeenCalledWith('u1', transactionId);
    expect(res).toEqual({ id: 's1' });
  });

  it('PUT → service.replace', async () => {
    service.replace.mockResolvedValue({ id: 's1' });
    const res = await controller.replace(user as never, transactionId, { cron: '0 9 * * *' });
    expect(service.replace).toHaveBeenCalledWith('u1', transactionId, { cron: '0 9 * * *' });
    expect(res).toEqual({ id: 's1' });
  });

  it('DELETE → service.remove (returns void)', async () => {
    service.remove.mockResolvedValue(undefined);
    await expect(controller.remove(user as never, transactionId)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('u1', transactionId);
  });

  it('POST /pause → service.pause', async () => {
    service.pause.mockResolvedValue({ id: 's1', pausedAt: '2026-05-15T00:00:00Z' });
    const res = await controller.pause(user as never, transactionId);
    expect(service.pause).toHaveBeenCalledWith('u1', transactionId);
    expect(res.pausedAt).toBe('2026-05-15T00:00:00Z');
  });

  it('POST /resume → service.resume', async () => {
    service.resume.mockResolvedValue({ id: 's1', pausedAt: null });
    const res = await controller.resume(user as never, transactionId);
    expect(service.resume).toHaveBeenCalledWith('u1', transactionId);
    expect(res.pausedAt).toBeNull();
  });

  it('POST /cancel → service.cancel', async () => {
    service.cancel.mockResolvedValue({ id: 's1', cancelledAt: '2026-05-15T00:00:00Z' });
    const res = await controller.cancel(user as never, transactionId);
    expect(service.cancel).toHaveBeenCalledWith('u1', transactionId);
    expect(res.cancelledAt).toBe('2026-05-15T00:00:00Z');
  });
});
