import {
  Body,
  Controller,
  Delete,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { ApplySuggestionsDto, ApplySuggestionsResultDto } from './dto/apply-suggestions.dto';
import { CreateFromLineDto } from './dto/create-from-line.dto';
import { ListLinesQueryDto } from './dto/list-lines-query.dto';
import { MatchLineDto } from './dto/match-line.dto';
import {
  StatementLineDecisionResponseDto,
  StatementLineListResponseDto,
} from './dto/statement-line-response.dto';
import { TransferLineDto } from './dto/transfer-line.dto';
import { StatementLineService } from './statement-line.service';

/**
 * Phase 20 · Iteration 20.4 — `/accounts/:accountId/lines` (design §6.2).
 *
 * The review queue: read the bank's lines, then decide each one — match it to
 * a transaction the app already had, create one from it, record it as a
 * transfer between own accounts, or ignore it. Every decision is undoable
 * with `DELETE …/link`, and nothing here ever blocks: a line may stay pending
 * forever. Reads 120/min, decisions 30/min, as elsewhere.
 */
@ApiTags('Accounts')
@Controller('accounts/:accountId/lines')
export class StatementLineController {
  constructor(private readonly service: StatementLineService) {}

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List an account's statement lines (newest posting first)",
    description:
      'Cursor-paginated, filterable by `status`, `importId` and `suggestion` ' +
      '(match | transfer | create | none | needs_input). `needs_input` is the review ' +
      'default: no proposal the matcher trusts, or a create proposal with no remembered ' +
      'category. Suggestions come back resolved — the transactions and categories they ' +
      'name are embedded, batched per page.',
  })
  @ApiOkResponse({ description: 'Paginated lines envelope', type: StatementLineListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: ListLinesQueryDto,
  ): Promise<StatementLineListResponseDto> {
    return this.service.list(user.sub, accountId, query);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post(':lineId/match')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Link a line to the transaction that already recorded it',
    description:
      'The transaction must be visible, not yet confirmed by another line, and agree on ' +
      'amount, currency and direction. It is then enriched (design §5.5): placed on this ' +
      'account when it floated unplaced, and posted when it was pending or due.',
  })
  @ApiBody({ type: MatchLineDto })
  @ApiOkResponse({
    description: 'The decided line and the enriched transaction',
    type: StatementLineDecisionResponseDto,
  })
  @ApiBadRequestResponse({ description: 'STATEMENT_MATCH_INVALID — the transaction differs' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account, line or transaction not visible' })
  @ApiConflictResponse({
    description: 'STATEMENT_LINE_NOT_PENDING, STATEMENT_LINE_ALREADY_LINKED or ACCOUNT_ARCHIVED',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async match(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: MatchLineDto,
  ): Promise<StatementLineDecisionResponseDto> {
    return this.service.match(user.sub, accountId, lineId, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post(':lineId/create')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a transaction from a line the app never recorded',
    description:
      'Direction, amount, currency, date and account come from the line; the caller supplies ' +
      "the categories and may override the note and attributions (default: the account's own " +
      'scope). Created through TransactionService — never a parallel write path.',
  })
  @ApiBody({ type: CreateFromLineDto })
  @ApiOkResponse({
    description: 'The decided line and the created transaction',
    type: StatementLineDecisionResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Category, attribution or account validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account or line not visible' })
  @ApiConflictResponse({ description: 'STATEMENT_LINE_NOT_PENDING or ACCOUNT_ARCHIVED' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: CreateFromLineDto,
  ): Promise<StatementLineDecisionResponseDto> {
    return this.service.createFromLine(user.sub, accountId, lineId, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post(':lineId/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Record the line as a transfer between two own accounts',
    description:
      'The classic case is a monthly card bill: an OUT line on the bank account pays the ' +
      'card. One OUT transaction under the `transfer` system category is created, which ' +
      'counts as spending nowhere. An IN line takes the other account as the source.',
  })
  @ApiBody({ type: TransferLineDto })
  @ApiOkResponse({
    description: 'The decided line and the created transfer',
    type: StatementLineDecisionResponseDto,
  })
  @ApiBadRequestResponse({ description: 'TRANSACTION_TRANSFER_INVALID or a currency mismatch' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account, line or the other account not visible' })
  @ApiConflictResponse({ description: 'STATEMENT_LINE_NOT_PENDING or ACCOUNT_ARCHIVED' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async transfer(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: TransferLineDto,
  ): Promise<StatementLineDecisionResponseDto> {
    return this.service.transferFromLine(user.sub, accountId, lineId, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post(':lineId/ignore')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark a line as not tracked',
    description: 'Kept for dedup and audit; reversible with DELETE …/link.',
  })
  @ApiOkResponse({ description: 'The ignored line', type: StatementLineDecisionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account or line not visible' })
  @ApiConflictResponse({ description: 'STATEMENT_LINE_NOT_PENDING' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async ignore(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<StatementLineDecisionResponseDto> {
    return this.service.ignore(user.sub, accountId, lineId);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Delete(':lineId/link')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Undo a decision — the line goes back to pending',
    description:
      'The transaction it produced or confirmed is left untouched; removing it is a ' +
      'separate, deliberate act. Idempotent.',
  })
  @ApiOkResponse({ description: 'The line, pending again', type: StatementLineDecisionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account or line not visible' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async unlink(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<StatementLineDecisionResponseDto> {
    return this.service.unlink(user.sub, accountId, lineId);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post('apply-suggestions')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Apply every confident suggestion at once',
    description:
      'Confident matches, transfer proposals and create proposals that carry a remembered ' +
      'category. Everything else is skipped and stays in the queue — nothing is forced, and ' +
      'each applied line remains undoable one by one.',
  })
  @ApiBody({ type: ApplySuggestionsDto })
  @ApiOkResponse({ description: 'What the run did', type: ApplySuggestionsResultDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Account not found or not visible to the caller' })
  @ApiConflictResponse({ description: 'ACCOUNT_ARCHIVED' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async applySuggestions(
    @CurrentUser() user: JwtPayload,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: ApplySuggestionsDto,
  ): Promise<ApplySuggestionsResultDto> {
    return this.service.applySuggestions(user.sub, accountId, dto);
  }
}
