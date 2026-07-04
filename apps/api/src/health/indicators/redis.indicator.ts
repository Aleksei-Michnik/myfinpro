import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import type { Queue } from 'bullmq';
import { PAYMENT_OCCURRENCES_QUEUE } from '../../queue/queue.constants';

/**
 * Hard cap for the Redis ping. ioredis's reconnect loop can otherwise hold
 * the request open for tens of seconds, which translates into a 504 from
 * upstream proxies; we'd rather fail fast with a clean 503 + `redis: down`.
 */
export const REDIS_PING_TIMEOUT_MS = 2000;

/**
 * Redis health indicator.
 *
 * Pings Redis through the BullMQ queue's underlying ioredis client. Reusing
 * the same connection avoids opening a separate Redis client just for the
 * probe and gives us early warning if BullMQ-side authentication breaks
 * (because we ping with whatever credentials BullMQ is using).
 *
 * The 2 s `Promise.race` timeout is the iteration 6.17.2 polish — without it,
 * a hung Redis turns `/health/details` into an upstream 504. With it, we
 * surface a clean 503 + `redis: { status: 'down', reason: 'ping_timeout' }`.
 *
 * Used by the deep `/api/v1/health/details` endpoint only — the lightweight
 * `/api/v1/health` liveness probe deliberately skips Redis so a transient
 * Redis hiccup never takes the API container out of the LB rotation.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue(PAYMENT_OCCURRENCES_QUEUE)
    private readonly queue: Queue,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = await this.queue.client;

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new RedisPingTimeoutError()),
          REDIS_PING_TIMEOUT_MS,
        );
      });

      let reply: string;
      try {
        reply = (await Promise.race([client.ping(), timeoutPromise])) as string;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }

      const ok = reply === 'PONG';
      if (!ok) {
        throw new HealthCheckError(
          'Redis check failed',
          this.getStatus(key, false, { message: `Unexpected ping reply: ${reply}` }),
        );
      }

      return this.getStatus(key, true, { reply });
    } catch (error) {
      if (error instanceof HealthCheckError) throw error;
      if (error instanceof RedisPingTimeoutError) {
        throw new HealthCheckError(
          'Redis check timed out',
          this.getStatus(key, false, { reason: 'ping_timeout' }),
        );
      }
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
  }
}

class RedisPingTimeoutError extends Error {
  constructor() {
    super('Redis ping timed out');
    this.name = 'RedisPingTimeoutError';
  }
}
