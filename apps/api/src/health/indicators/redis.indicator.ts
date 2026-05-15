import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import type { Queue } from 'bullmq';
import { PAYMENT_OCCURRENCES_QUEUE } from '../../queue/queue.constants';

/**
 * Redis health indicator.
 *
 * Pings Redis through the BullMQ queue's underlying ioredis client. Reusing
 * the same connection avoids opening a separate Redis client just for the
 * probe and gives us early warning if BullMQ-side authentication breaks
 * (because we ping with whatever credentials BullMQ is using).
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
      const reply = await client.ping();
      const ok = reply === 'PONG';

      if (!ok) {
        throw new HealthCheckError(
          'Redis check failed',
          this.getStatus(key, false, { message: `Unexpected ping reply: ${reply}` }),
        );
      }

      return this.getStatus(key, true, { reply });
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
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
