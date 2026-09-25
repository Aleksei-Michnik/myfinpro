import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrApiTokenGuard } from '../auth/guards/jwt-or-api-token.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { AccountImportService } from './account-import.service';
import {
  AccountImportListResponseDto,
  AccountImportResponseDto,
} from './dto/account-import-response.dto';
import { CreateImportDto } from './dto/create-import.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';

/**
 * Phase 20 · Iteration 20.4 — `/accounts/:accountId/imports` (design §6.2).
 *
 * The statement FILE never reaches this API: the browser decodes and parses
 * it (`packages/shared/src/statement`) and posts normalised JSON lines, which
 * is what keeps an untrusted spreadsheet off the server entirely (§3.5).
 * Imports are throttled harder than other writes (10/min) because one call
 * carries up to 2000 lines and runs the matcher inline.
 */
@ApiTags('Accounts')
@Controller('accounts/:accountId/imports')
export class AccountImportController {
  constructor(private readonly service: AccountImportService) {}

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(JwtOrApiTokenGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Import parsed statement lines into an account',
    description:
      'Owner or any group member — importing is data entry. Lines must be in the account ' +
      'currency and are deduplicated by a server-computed fingerprint, so re-importing an ' +
      'overlapping statement is safe: duplicates are counted, never rejected. The matcher ' +
      'runs inline and stores a suggestion on every new line. A statement longer than the ' +
      'line cap is sent in consecutive chunks, one import each. This is the ONE route that ' +
      'also accepts a personal access token (20.7, design §6.4): a `mfp_…` bearer with the ' +
      '`accounts:import` scope, which is what the user-run connector pushes with.',
  })
  @ApiBody({ type: CreateImportDto })
  @ApiCreatedResponse({
    description: 'Import summary with counters',
    type: AccountImportResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed: ACCOUNT_IMPORT_TOO_LARGE, ACCOUNT_IMPORT_INVALID_LINE (index only) ' +
      'or ACCOUNT_CURRENCY_MISMATCH',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT / API token' })
  @ApiForbiddenResponse({ description: "API_TOKEN_SCOPE — the token lacks 'accounts:import'" })
  @ApiNotFoundResponse({ description: 'Account not found or not visible to the caller' })
  @ApiConflictResponse({ description: 'Account is archived' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (10/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateImportDto,
  ): Promise<AccountImportResponseDto> {
    return this.service.create(user.sub, accountId, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List an account's imports (newest first)",
    description:
      'Cursor-paginated. The row counters are frozen at import time; the suggestion counters ' +
      'describe what is still pending review.',
  })
  @ApiOkResponse({ description: 'Paginated imports envelope', type: AccountImportListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: ListImportsQueryDto,
  ): Promise<AccountImportListResponseDto> {
    return this.service.list(user.sub, accountId, query);
  }
}
