import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { NoRateLimit } from '../common/decorators/throttle.decorator';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { MemoryHealthIndicator } from './indicators/memory.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';

@ApiTags('Health')
@NoRateLimit()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint (summary)' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.isHealthy('database'),
      // Use RSS-based threshold (512MB) instead of heap % which fluctuates
      // with V8 GC cycles and causes false positives at 95% heap usage
      () => this.memory.isHealthy('memory', 512),
    ]);
  }

  @Get('details')
  @HealthCheck()
  @ApiOperation({ summary: 'Detailed health check endpoint' })
  checkDetails(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.memory.isHealthy('memory', 256),
      () => this.redis.isHealthy('redis'),
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }
}
