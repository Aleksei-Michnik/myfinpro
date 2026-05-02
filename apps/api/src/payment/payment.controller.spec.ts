import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

describe('PaymentController', () => {
  let controller: PaymentController;

  const serviceMock = {
    create: jest.fn(),
    list: jest.fn(),
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
});
