import { Test, TestingModule } from '@nestjs/testing';
import { PaymentScheduleController } from './payment-schedule.controller';
import { PaymentScheduleService } from './payment-schedule.service';

describe('PaymentScheduleController', () => {
  let controller: PaymentScheduleController;
  let service: { create: jest.Mock; get: jest.Mock; replace: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      get: jest.fn(),
      replace: jest.fn(),
      remove: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentScheduleController],
      providers: [{ provide: PaymentScheduleService, useValue: service }],
    }).compile();
    controller = module.get(PaymentScheduleController);
  });

  const user = { sub: 'u1' } as { sub: string };
  const paymentId = 'p1';

  it('POST → service.create', async () => {
    service.create.mockResolvedValue({ id: 's1' });
    const res = await controller.create(user as never, paymentId, { everyMs: 60_000 });
    expect(service.create).toHaveBeenCalledWith('u1', paymentId, { everyMs: 60_000 });
    expect(res).toEqual({ id: 's1' });
  });

  it('GET → service.get', async () => {
    service.get.mockResolvedValue({ id: 's1' });
    const res = await controller.get(user as never, paymentId);
    expect(service.get).toHaveBeenCalledWith('u1', paymentId);
    expect(res).toEqual({ id: 's1' });
  });

  it('PUT → service.replace', async () => {
    service.replace.mockResolvedValue({ id: 's1' });
    const res = await controller.replace(user as never, paymentId, { cron: '0 9 * * *' });
    expect(service.replace).toHaveBeenCalledWith('u1', paymentId, { cron: '0 9 * * *' });
    expect(res).toEqual({ id: 's1' });
  });

  it('DELETE → service.remove (returns void)', async () => {
    service.remove.mockResolvedValue(undefined);
    await expect(controller.remove(user as never, paymentId)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('u1', paymentId);
  });
});
