import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

/**
 * Placeholder Redis health indicator.
 * Will be fully implemented when Redis is added to the stack.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    // Placeholder: always returns healthy with a note that Redis is not yet configured
    return this.getStatus(key, true, {
      message: 'Redis not yet configured — placeholder check',
    });
  }
}
