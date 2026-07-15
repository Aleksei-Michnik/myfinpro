import { ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { TransactionCommentController } from './transaction-comment.controller';
import { TransactionCommentService } from './transaction-comment.service';

describe('TransactionCommentController', () => {
  let controller: TransactionCommentController;
  const svc = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const user: JwtPayload = { sub: 'u1', email: 'a@b', name: 'A' };

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [TransactionCommentController],
      providers: [{ provide: TransactionCommentService, useValue: svc }],
    }).compile();
    controller = mod.get(TransactionCommentController);
    jest.clearAllMocks();
  });

  it('1. GET / delegates to service.list with user.sub, transactionId, query', async () => {
    svc.list.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    const r = await controller.list(user, 'p1', { limit: 10 });
    expect(svc.list).toHaveBeenCalledWith('u1', 'p1', { limit: 10 });
    expect(r.hasMore).toBe(false);
  });

  it('2. POST / delegates to service.create and returns payload', async () => {
    const payload = { id: 'c1', content: 'x', isMine: true };
    svc.create.mockResolvedValue(payload);
    const r = await controller.create(user, 'p1', { content: 'x' });
    expect(svc.create).toHaveBeenCalledWith('u1', 'p1', { content: 'x' });
    expect(r).toBe(payload);
  });

  it('3. PATCH /:commentId delegates to service.update', async () => {
    svc.update.mockResolvedValue({ id: 'c1', content: 'y' });
    await controller.update(user, 'p1', 'c1', { content: 'y' });
    expect(svc.update).toHaveBeenCalledWith('u1', 'p1', 'c1', { content: 'y' });
  });

  it('4. PATCH propagates 410 Gone from service', async () => {
    svc.update.mockRejectedValue(
      new HttpException({ errorCode: 'TRANSACTION_COMMENT_DELETED' }, HttpStatus.GONE),
    );
    await expect(controller.update(user, 'p1', 'c1', { content: 'y' })).rejects.toThrow(
      HttpException,
    );
  });

  it('5. PATCH propagates 403 from service', async () => {
    svc.update.mockRejectedValue(new ForbiddenException());
    await expect(controller.update(user, 'p1', 'c1', { content: 'y' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('6. DELETE /:commentId delegates + returns void', async () => {
    svc.remove.mockResolvedValue(undefined);
    const r = await controller.remove(user, 'p1', 'c1');
    expect(svc.remove).toHaveBeenCalledWith('u1', 'p1', 'c1');
    expect(r).toBeUndefined();
  });

  it('7. DELETE propagates 404 from service', async () => {
    svc.remove.mockRejectedValue(new NotFoundException());
    await expect(controller.remove(user, 'p1', 'c1')).rejects.toThrow(NotFoundException);
  });

  it('8. DELETE carries HttpCode(NO_CONTENT) metadata', () => {
    // '__httpCode__' is the constant NestJS uses for @HttpCode metadata.
    const handler = Object.getPrototypeOf(controller).remove as () => unknown;
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(HttpStatus.NO_CONTENT);
  });

  it('9. POST carries HttpCode(CREATED) metadata', () => {
    const handler = Object.getPrototypeOf(controller).create as () => unknown;
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(HttpStatus.CREATED);
  });

  it('10. list handler has 120/min throttle', () => {
    const reflector = new Reflector();
    const handler = Object.getPrototypeOf(controller).list as () => unknown;
    expect(reflector.get<number>('THROTTLER:LIMITdefault', handler)).toBe(120);
    expect(reflector.get<number>('THROTTLER:TTLdefault', handler)).toBe(60000);
  });

  it('11. create / update / remove handlers have 20/min throttle', () => {
    const reflector = new Reflector();
    for (const name of ['create', 'update', 'remove'] as const) {
      const handler = Object.getPrototypeOf(controller)[name] as () => unknown;
      expect(reflector.get<number>('THROTTLER:LIMITdefault', handler)).toBe(20);
      expect(reflector.get<number>('THROTTLER:TTLdefault', handler)).toBe(60000);
    }
  });
});
