import { Test, TestingModule } from '@nestjs/testing';
import { PaymentPlanController } from './payment-plan.controller';
import { PaymentPlanService } from './payment-plan.service';

describe('PaymentPlanController', () => {
  let controller: PaymentPlanController;
  let service: {
    get: jest.Mock;
    cancel: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      get: jest.fn(),
      cancel: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentPlanController],
      providers: [{ provide: PaymentPlanService, useValue: service }],
    }).compile();
    controller = module.get(PaymentPlanController);
  });

  const user = { sub: 'u1' } as { sub: string };
  const paymentId = 'p1';

  it('GET → service.get', async () => {
    service.get.mockResolvedValue({ id: 'plan-1', rows: [] });
    const res = await controller.get(user as never, paymentId);
    expect(service.get).toHaveBeenCalledWith('u1', paymentId);
    expect(res).toEqual({ id: 'plan-1', rows: [] });
  });

  it('DELETE → service.cancel (returns the updated plan)', async () => {
    service.cancel.mockResolvedValue({ id: 'plan-1', cancelledAt: '2026-07-04T00:00:00.000Z' });
    const res = await controller.cancel(user as never, paymentId);
    expect(service.cancel).toHaveBeenCalledWith('u1', paymentId);
    expect(res).toEqual({ id: 'plan-1', cancelledAt: '2026-07-04T00:00:00.000Z' });
  });
});
