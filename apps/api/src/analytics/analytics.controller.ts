import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AnalyticsQueryResponseDto } from './dto/analytics-query-response.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsEngineService } from './engine/analytics-engine.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly engine: AnalyticsEngineService) {}

  /**
   * POST despite being a read — the query object is too structured for query
   * strings (design §5). Never mutates state.
   */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run a configurable spend aggregation',
    description:
      'Groups the caller-visible purchase rows (hybrid grain — receipt items where confirmed, ' +
      'transaction headers otherwise, balancing rows keeping totals exact) by 0–2 dimensions ' +
      'plus currency. Per-currency results, no FX conversion.',
  })
  @ApiBody({ type: AnalyticsQueryDto })
  @ApiOkResponse({ type: AnalyticsQueryResponseDto })
  @ApiBadRequestResponse({ description: 'ANALYTICS_INVALID_QUERY | ANALYTICS_INVALID_CURSOR' })
  @ApiForbiddenResponse({ description: 'ANALYTICS_SCOPE_FORBIDDEN — non-member group scope' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  query(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AnalyticsQueryDto,
  ): Promise<AnalyticsQueryResponseDto> {
    return this.engine.runQuery(user.sub, dto);
  }
}
