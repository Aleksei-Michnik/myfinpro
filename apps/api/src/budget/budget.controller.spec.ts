import { Test, TestingModule } from '@nestjs/testing';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

describe('BudgetController', () => {
  let controller: BudgetController;
  let service: {
    create: jest.Mock;
    list: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    archive: jest.Mock;
    unarchive: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      archive: jest.fn(),
      unarchive: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BudgetController],
      providers: [{ provide: BudgetService, useValue: service }],
    }).compile();
    controller = module.get(BudgetController);
  });

  const user = { sub: 'u1' } as { sub: string };
  const budgetId = 'b1';

  it('POST → service.create', async () => {
    const dto = { name: 'Groceries', amountCents: 100, scopeType: 'personal', period: 'MONTHLY' };
    service.create.mockResolvedValue({ id: budgetId });
    const res = await controller.create(user as never, dto as never);
    expect(service.create).toHaveBeenCalledWith('u1', dto);
    expect(res).toEqual({ id: budgetId });
  });

  it('GET → service.list', async () => {
    const query = { scope: 'personal', includeArchived: 'true' };
    service.list.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    const res = await controller.list(user as never, query as never);
    expect(service.list).toHaveBeenCalledWith('u1', query);
    expect(res).toEqual({ data: [], nextCursor: null, hasMore: false });
  });

  it('GET :id → service.findById', async () => {
    service.findById.mockResolvedValue({ id: budgetId });
    const res = await controller.findOne(user as never, budgetId);
    expect(service.findById).toHaveBeenCalledWith('u1', budgetId);
    expect(res).toEqual({ id: budgetId });
  });

  it('PATCH :id → service.update', async () => {
    const dto = { name: 'Food' };
    service.update.mockResolvedValue({ id: budgetId, name: 'Food' });
    const res = await controller.update(user as never, budgetId, dto as never);
    expect(service.update).toHaveBeenCalledWith('u1', budgetId, dto);
    expect(res).toEqual({ id: budgetId, name: 'Food' });
  });

  it('DELETE :id → service.remove (204, empty body)', async () => {
    service.remove.mockResolvedValue(undefined);
    await expect(controller.remove(user as never, budgetId)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('u1', budgetId);
  });

  it('POST :id/archive → service.archive', async () => {
    service.archive.mockResolvedValue({ id: budgetId, archivedAt: '2026-07-04T00:00:00.000Z' });
    const res = await controller.archive(user as never, budgetId);
    expect(service.archive).toHaveBeenCalledWith('u1', budgetId);
    expect(res).toEqual({ id: budgetId, archivedAt: '2026-07-04T00:00:00.000Z' });
  });

  it('POST :id/unarchive → service.unarchive', async () => {
    service.unarchive.mockResolvedValue({ id: budgetId, archivedAt: null });
    const res = await controller.unarchive(user as never, budgetId);
    expect(service.unarchive).toHaveBeenCalledWith('u1', budgetId);
    expect(res).toEqual({ id: budgetId, archivedAt: null });
  });
});
