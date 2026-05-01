import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';

describe('CategoryController', () => {
  let controller: CategoryController;

  const serviceMock = {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const user: JwtPayload = { sub: 'user-1', email: 'a@b', name: 'A' };

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [{ provide: CategoryService, useValue: serviceMock }],
    }).compile();
    controller = mod.get(CategoryController);
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET / delegates to service.list with userId and query', async () => {
    serviceMock.list.mockResolvedValue([{ id: 'cat-1' }]);

    const result = await controller.list(user, { scope: 'all' });

    expect(serviceMock.list).toHaveBeenCalledWith('user-1', { scope: 'all' });
    expect(result).toEqual([{ id: 'cat-1' }]);
  });

  it('GET /:id delegates to service.findById', async () => {
    serviceMock.findById.mockResolvedValue({ id: 'cat-1' });

    const r = await controller.findOne(user, 'cat-1');

    expect(serviceMock.findById).toHaveBeenCalledWith('user-1', 'cat-1');
    expect(r).toEqual({ id: 'cat-1' });
  });

  it('POST / delegates to service.create with payload', async () => {
    const dto = { name: 'Coffee', direction: 'OUT' as const, scope: 'personal' as const };
    serviceMock.create.mockResolvedValue({ id: 'cat-new' });

    const r = await controller.create(user, dto);

    expect(serviceMock.create).toHaveBeenCalledWith('user-1', dto);
    expect(r).toEqual({ id: 'cat-new' });
  });

  it('PATCH /:id delegates to service.update', async () => {
    serviceMock.update.mockResolvedValue({ id: 'cat-1', name: 'New' });

    const r = await controller.update(user, 'cat-1', { name: 'New' });

    expect(serviceMock.update).toHaveBeenCalledWith('user-1', 'cat-1', { name: 'New' });
    expect(r.name).toBe('New');
  });

  it('DELETE /:id without replacement delegates correctly', async () => {
    serviceMock.remove.mockResolvedValue({ deleted: true, reassigned: 0 });

    const r = await controller.remove(user, 'cat-1', {});

    expect(serviceMock.remove).toHaveBeenCalledWith('user-1', 'cat-1', {});
    expect(r).toEqual({ deleted: true, reassigned: 0 });
  });

  it('DELETE /:id with replaceWithCategoryId forwards query', async () => {
    serviceMock.remove.mockResolvedValue({ deleted: true, reassigned: 7 });

    const r = await controller.remove(user, 'cat-1', { replaceWithCategoryId: 'cat-2' });

    expect(serviceMock.remove).toHaveBeenCalledWith('user-1', 'cat-1', {
      replaceWithCategoryId: 'cat-2',
    });
    expect(r.reassigned).toBe(7);
  });

  it('propagates service errors upward', async () => {
    serviceMock.list.mockRejectedValue(new Error('boom'));
    await expect(controller.list(user, {})).rejects.toThrow('boom');
  });
});
