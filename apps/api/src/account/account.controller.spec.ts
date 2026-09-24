import { Test, TestingModule } from '@nestjs/testing';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

describe('AccountController', () => {
  let controller: AccountController;
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
      controllers: [AccountController],
      providers: [{ provide: AccountService, useValue: service }],
    }).compile();
    controller = module.get(AccountController);
  });

  const user = { sub: 'u1' } as { sub: string };
  const accountId = 'a1';

  it('POST → service.create', async () => {
    const dto = { name: 'Checking', kind: 'BANK', scopeType: 'personal' };
    service.create.mockResolvedValue({ id: accountId });
    const res = await controller.create(user as never, dto as never);
    expect(service.create).toHaveBeenCalledWith('u1', dto);
    expect(res).toEqual({ id: accountId });
  });

  it('GET → service.list', async () => {
    const query = { scope: 'personal', includeArchived: 'true' };
    service.list.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    const res = await controller.list(user as never, query as never);
    expect(service.list).toHaveBeenCalledWith('u1', query);
    expect(res).toEqual({ data: [], nextCursor: null, hasMore: false });
  });

  it('GET :id → service.findById', async () => {
    service.findById.mockResolvedValue({ id: accountId });
    const res = await controller.findOne(user as never, accountId);
    expect(service.findById).toHaveBeenCalledWith('u1', accountId);
    expect(res).toEqual({ id: accountId });
  });

  it('PATCH :id → service.update', async () => {
    const dto = { name: 'Main checking' };
    service.update.mockResolvedValue({ id: accountId, name: 'Main checking' });
    const res = await controller.update(user as never, accountId, dto as never);
    expect(service.update).toHaveBeenCalledWith('u1', accountId, dto);
    expect(res).toEqual({ id: accountId, name: 'Main checking' });
  });

  it('DELETE :id → service.remove (204, empty body)', async () => {
    service.remove.mockResolvedValue(undefined);
    await expect(controller.remove(user as never, accountId)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('u1', accountId);
  });

  it('POST :id/archive → service.archive', async () => {
    service.archive.mockResolvedValue({ id: accountId, archivedAt: '2026-09-25T00:00:00.000Z' });
    const res = await controller.archive(user as never, accountId);
    expect(service.archive).toHaveBeenCalledWith('u1', accountId);
    expect(res).toEqual({ id: accountId, archivedAt: '2026-09-25T00:00:00.000Z' });
  });

  it('POST :id/unarchive → service.unarchive', async () => {
    service.unarchive.mockResolvedValue({ id: accountId, archivedAt: null });
    const res = await controller.unarchive(user as never, accountId);
    expect(service.unarchive).toHaveBeenCalledWith('u1', accountId);
    expect(res).toEqual({ id: accountId, archivedAt: null });
  });
});
