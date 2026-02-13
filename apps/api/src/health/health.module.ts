import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { MemoryHealthIndicator } from './indicators/memory.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    MemoryHealthIndicator,
    RedisHealthIndicator,
  ],
})
export class HealthModule {}
