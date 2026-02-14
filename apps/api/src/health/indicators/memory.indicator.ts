import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

@Injectable()
export class MemoryHealthIndicator extends HealthIndicator {
  /**
   * Check heap memory usage.
   * @param key - The key which will be used for the result object
   * @param thresholdPercent - Warn threshold as a percentage (default 80)
   */
  async isHealthy(key: string, thresholdPercent = 80): Promise<HealthIndicatorResult> {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const usagePercent = heapTotalMB > 0 ? Math.round((heapUsedMB / heapTotalMB) * 100) : 0;

    const details = {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      usagePercent: `${usagePercent}%`,
    };

    const isHealthy = usagePercent < thresholdPercent;

    if (isHealthy) {
      return this.getStatus(key, true, details);
    }

    throw new HealthCheckError(
      `Memory usage ${usagePercent}% exceeds threshold ${thresholdPercent}%`,
      this.getStatus(key, false, details),
    );
  }
}
