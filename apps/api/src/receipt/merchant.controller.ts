import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { ReceiptService } from './receipt.service';

/**
 * Phase 7, iteration 7.8 — global merchant registry lookup (design §2.3).
 * Read-only: entries are created at receipt-confirm time (7.9), never here.
 */
@ApiTags('Merchants')
@Controller('merchants')
export class MerchantController {
  constructor(private readonly service: ReceiptService) {}

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Search the global merchant registry',
    description: 'Normalized-contains match on the dedup key; max 10 results.',
  })
  @ApiQuery({ name: 'search', required: true })
  @ApiOkResponse({ description: 'Matching merchants (id + display name)' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async search(@Query('search') search = ''): Promise<{ id: string; name: string }[]> {
    return this.service.searchMerchants(search);
  }
}
