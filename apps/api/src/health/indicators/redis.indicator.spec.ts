import { getQueueToken } from '@nestjs/bullmq';
import { HealthCheckError } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { PAYMENT_OCCURRENCES_QUEUE } from '../../queue/queue.constants';
import { RedisHealthIndicator } from './redis.indicator';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let pingMock: jest.Mock;

  async function build(client: { ping: jest.Mock }) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        {
          provide: getQueueToken(PAYMENT_OCCURRENCES_QUEUE),
          useValue: { client: Promise.resolve(client) },
        },
      ],
    }).compile();
    indicator = module.get(RedisHealthIndicator);
  }

  beforeEach(() => {
    pingMock = jest.fn();
  });

  it('returns up when redis replies PONG', async () => {
    pingMock.mockResolvedValue('PONG');
    await build({ ping: pingMock });

    const result = await indicator.isHealthy('redis');

    expect(pingMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ redis: { status: 'up', reply: 'PONG' } });
  });

  it('throws HealthCheckError when redis replies something other than PONG', async () => {
    pingMock.mockResolvedValue('NOPE');
    await build({ ping: pingMock });

    await expect(indicator.isHealthy('redis')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('throws HealthCheckError when ping itself rejects', async () => {
    pingMock.mockRejectedValue(new Error('connection refused'));
    await build({ ping: pingMock });

    try {
      await indicator.isHealthy('redis');
      throw new Error('expected indicator to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HealthCheckError);
      const err = error as HealthCheckError;
      expect(err.causes).toEqual({
        redis: {
          status: 'down',
          message: 'connection refused',
        },
      });
    }
  });

  it('throws HealthCheckError with reason=ping_timeout when ping hangs longer than 2 s', async () => {
    jest.useFakeTimers();
    try {
      // A ping that never resolves — emulates ioredis stuck reconnecting.
      const hanging = new Promise<string>(() => {
        /* never resolves */
      });
      pingMock.mockReturnValue(hanging);
      await build({ ping: pingMock });

      const promise = indicator.isHealthy('redis');
      // Attach a catch handler synchronously so the rejection is observed.
      const settled = promise.catch((err) => err);

      // Advance past the 2 s threshold; tick again to flush the rejection.
      await jest.advanceTimersByTimeAsync(2500);

      const error = await settled;
      expect(error).toBeInstanceOf(HealthCheckError);
      expect((error as HealthCheckError).causes).toEqual({
        redis: { status: 'down', reason: 'ping_timeout' },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
