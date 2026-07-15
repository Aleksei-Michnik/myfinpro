import { Test, TestingModule } from '@nestjs/testing';
import { TransactionPlanController } from './transaction-plan.controller';
import { TransactionPlanService } from './transaction-plan.service';

describe('TransactionPlanController', () => {
  let controller: TransactionPlanController;
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
      controllers: [TransactionPlanController],
      providers: [{ provide: TransactionPlanService, useValue: service }],
    }).compile();
    controller = module.get(TransactionPlanController);
  });

  const user = { sub: 'u1' } as { sub: string };
  const transactionId = 'p1';

  it('GET → service.get', async () => {
    service.get.mockResolvedValue({ id: 'plan-1', rows: [] });
    const res = await controller.get(user as never, transactionId);
    expect(service.get).toHaveBeenCalledWith('u1', transactionId);
    expect(res).toEqual({ id: 'plan-1', rows: [] });
  });

  it('DELETE → service.cancel (returns the updated plan)', async () => {
    service.cancel.mockResolvedValue({ id: 'plan-1', cancelledAt: '2026-07-04T00:00:00.000Z' });
    const res = await controller.cancel(user as never, transactionId);
    expect(service.cancel).toHaveBeenCalledWith('u1', transactionId);
    expect(res).toEqual({ id: 'plan-1', cancelledAt: '2026-07-04T00:00:00.000Z' });
  });
});
