import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { NoRateLimit } from '../decorators/throttle.decorator';

import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@NoRateLimit()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Application metrics' })
  getMetrics() {
    return this.metricsService.getMetrics();
  }
}
