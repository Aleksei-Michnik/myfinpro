import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

describe('PaymentController', () => {
  let controller: PaymentController;

  const serviceMock = {
    create: jest.fn(),
    list: jest.fn(),
    findByIdForUser: jest.fn(),
    update: jest.fn(),
  };

  const user: JwtPayload = { sub: 'user-1', email: 'a@b', name: 'A' };

  const dto: CreatePaymentDto = {
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1250,
    currency: 'USD',
    occurredAt: '2026-04-25',
    categoryId: '00000000-0000-0000-0000-000000000001',
    attributions: [{ scope: 'personal' }],
  };

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [{ provide: PaymentService, useValue: serviceMock }],
    }).compile();
    controller = mod.get(PaymentController);
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('POST / delegates to service.create with user.sub + body', async () => {
    serviceMock.create.mockResolvedValue({ id: 'pay-1' });

    const r = await controller.create(user, dto);

    expect(serviceMock.create).toHaveBeenCalledWith('user-1', dto);
    expect(r).toEqual({ id: 'pay-1' });
  });

  it('returns the service payload unchanged', async () => {
    const payload = { id: 'pay-1', direction: 'OUT', amountCents: 1250 };
    serviceMock.create.mockResolvedValue(payload);

    const r = await controller.create(user, dto);

    expect(r).toBe(payload);
  });

  it('propagates service errors upward', async () => {
    serviceMock.create.mockRejectedValue(new Error('boom'));
    await expect(controller.create(user, dto)).rejects.toThrow('boom');
  });

  it('uses the authenticated user id from the JWT sub claim', async () => {
    serviceMock.create.mockResolvedValue({});
    const other: JwtPayload = { sub: 'user-42', email: 'x@y', name: 'X' };

    await controller.create(other, dto);

    expect(serviceMock.create).toHaveBeenCalledWith('user-42', dto);
  });

  // ── iteration 6.6: GET /payments ──

  describe('list()', () => {
    const query: ListPaymentsQueryDto = { limit: 5, sort: 'date_desc' };

    it('delegates to service.list with user.sub + query', async () => {
      const payload = { data: [], nextCursor: null, hasMore: false };
      serviceMock.list.mockResolvedValue(payload);

      const r = await controller.list(user, query);

      expect(serviceMock.list).toHaveBeenCalledWith('user-1', query);
      expect(r).toBe(payload);
    });

    it('returns the service payload unchanged', async () => {
      const payload = {
        data: [{ id: 'p1' }],
        nextCursor: 'abc',
        hasMore: true,
      };
      serviceMock.list.mockResolvedValue(payload);

      const r = await controller.list(user, query);
      expect(r).toBe(payload);
    });

    it('propagates service errors upward', async () => {
      serviceMock.list.mockRejectedValue(new Error('boom'));
      await expect(controller.list(user, query)).rejects.toThrow('boom');
    });

    it('applies 120/min rate limit metadata via @CustomThrottle', () => {
      const reflector = new Reflector();
      const listHandler = Object.getPrototypeOf(controller).list as () => unknown;
      // @nestjs/throttler defines a metadata key per (field, throttler name) — see
      // throttler.decorator.js. Default throttler name is 'default'.
      const limit = reflector.get<number>('THROTTLER:LIMITdefault', listHandler);
      const ttl = reflector.get<number>('THROTTLER:TTLdefault', listHandler);
      expect(limit).toBe(120);
      expect(ttl).toBe(60000);
    });
  });

  // ── iteration 6.7: GET/:id + PATCH/:id ──

  describe('findOne()', () => {
    it('delegates to service.findByIdForUser with user.sub + id', async () => {
      const payload = { id: 'pay-1' };
      serviceMock.findByIdForUser.mockResolvedValue(payload);

      const r = await controller.findOne(user, 'pay-1');

      expect(serviceMock.findByIdForUser).toHaveBeenCalledWith('user-1', 'pay-1');
      expect(r).toBe(payload);
    });

    it('propagates NotFoundException from the service', async () => {
      serviceMock.findByIdForUser.mockRejectedValue(new NotFoundException('not found'));
      await expect(controller.findOne(user, 'pay-1')).rejects.toThrow(NotFoundException);
    });

    it('applies 120/min rate limit metadata', () => {
      const reflector = new Reflector();
      const handler = Object.getPrototypeOf(controller).findOne as () => unknown;
      expect(reflector.get<number>('THROTTLER:LIMITdefault', handler)).toBe(120);
      expect(reflector.get<number>('THROTTLER:TTLdefault', handler)).toBe(60000);
    });
  });

  describe('update()', () => {
    const updateDto: UpdatePaymentDto = { note: 'updated' };

    it('delegates to service.update with user.sub + id + dto', async () => {
      const payload = { id: 'pay-1', note: 'updated' };
      serviceMock.update.mockResolvedValue(payload);

      const r = await controller.update(user, 'pay-1', updateDto);

      expect(serviceMock.update).toHaveBeenCalledWith('user-1', 'pay-1', updateDto);
      expect(r).toBe(payload);
    });

    it('propagates ForbiddenException from the service', async () => {
      serviceMock.update.mockRejectedValue(new ForbiddenException('not owner'));
      await expect(controller.update(user, 'pay-1', updateDto)).rejects.toThrow(ForbiddenException);
    });

    it('applies 30/min rate limit metadata', () => {
      const reflector = new Reflector();
      const handler = Object.getPrototypeOf(controller).update as () => unknown;
      expect(reflector.get<number>('THROTTLER:LIMITdefault', handler)).toBe(30);
      expect(reflector.get<number>('THROTTLER:TTLdefault', handler)).toBe(60000);
    });
  });
});
