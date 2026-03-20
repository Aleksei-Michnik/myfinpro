import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

@Injectable()
export class MemoryHealthIndicator extends HealthIndicator {
  /**
   * Check memory usage using RSS (Resident Set Size).
   * RSS is a more reliable metric than heap percentage because V8's
   * garbage collector naturally keeps heap usage at 90-95% between
   * GC cycles, causing false positives with heap-based thresholds.
   *
   * @param key - The key which will be used for the result object
   * @param thresholdMB - RSS threshold in megabytes (default 512)
   */
  async isHealthy(key: string, thresholdMB = 512): Promise<HealthIndicatorResult> {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);

    const details = {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      thresholdMB,
    };

    const isHealthy = rssMB < thresholdMB;

    if (isHealthy) {
      return this.getStatus(key, true, details);
    }

    throw new HealthCheckError(
      `Memory RSS ${rssMB}MB exceeds threshold ${thresholdMB}MB`,
      this.getStatus(key, false, details),
    );
  }
}
