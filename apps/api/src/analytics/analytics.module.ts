import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEngineService } from './engine/analytics-engine.service';

/**
 * Phase 9 — Purchase Analytics (design: docs/phase-9-analytics-design.md).
 *
 * 9.1: the aggregation engine + POST /analytics/query. Later iterations add
 * saved views, price dynamics, merchant rollups, and habit summaries here.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsEngineService],
  exports: [AnalyticsEngineService],
})
export class AnalyticsModule {}
