import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { AttributionChangeResultDto } from './dto/attribution-change-result.dto';
import { CascadeEditResponseDto } from './dto/cascade-edit-response.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { DeleteTransactionQueryDto } from './dto/delete-transaction.query.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { ToggleStarResponseDto } from './dto/toggle-star-response.dto';
import { TransactionListResponseDto } from './dto/transaction-list-response.dto';
import { TransactionSummaryDto } from './dto/transaction-summary.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { UpdateTransactionQueryDto } from './dto/update-transaction.query.dto';
import { TransactionService } from './transaction.service';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionController {
  constructor(private readonly service: TransactionService) {}

  @CustomThrottle({ limit: 30, ttl: 60000 }) // design §5.8 — 30/min per caller
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a transaction',
    description:
      'Only `type = "ONE_TIME"` is accepted in this iteration (6.5). RECURRING / LIMITED_PERIOD / ' +
      'INSTALLMENT / LOAN / MORTGAGE ship in iterations 6.17 and 6.19.',
  })
  @ApiBody({ type: CreateTransactionDto })
  @ApiCreatedResponse({ description: 'Transaction created', type: TransactionSummaryDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Attribution out of scope (group non-member)' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionSummaryDto> {
    return this.service.create(user.sub, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 }) // design §5.8 — 120/min per caller
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List transactions visible to the current user',
    description:
      'Cursor-paginated. Visibility union of personal (current user) + all groups the user is a ' +
      'member of. Use `scope=personal` or `scope=group:<id>` to narrow.',
  })
  @ApiOkResponse({
    description: 'Paginated transactions envelope',
    type: TransactionListResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Requested group scope is not accessible' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponseDto> {
    return this.service.list(user.sub, query);
  }

  /**
   * Iteration 6.18.1.3 — ergonomic alias over `GET /transactions?parentTransactionId=:id`.
   *
   * Returns the occurrences (`parentTransactionId === :transactionId`) generated
   * from a recurring parent. The web client's `<RecurringOccurrencesSection>`
   * uses this alias rather than constructing the query manually so the call
   * site stays free of filter knowledge.
   *
   * Visibility on the parent is enforced (404 leak-free) by the underlying
   * `service.list` filter handling. Cursor pagination + sort accept the
   * same query knobs as the main list endpoint, minus `parentTransactionId`
   * itself (set from the route param) and `withParent` (would conflict).
   */
  @CustomThrottle({ limit: 120, ttl: 60000 }) // design §5.8 — 120/min read
  @UseGuards(JwtAuthGuard)
  @Get(':transactionId/occurrences')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List child occurrences of a recurring parent transaction',
    description:
      'Thin alias for `GET /transactions?parentTransactionId=:transactionId`. Returns the ' +
      'generated occurrences for a recurring parent. Visibility on the parent ' +
      'is enforced (404 leak-free).',
  })
  @ApiOkResponse({
    description: 'Paginated occurrences envelope',
    type: TransactionListResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Parent not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async listOccurrences(
    @CurrentUser() user: JwtPayload,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponseDto> {
    // Force the parent filter from the path param; ignore conflicting
    // `parentTransactionId` / `withParent` query keys to keep the alias's
    // contract identity-clean.
    const merged: ListTransactionsQueryDto = {
      ...query,
      parentTransactionId: transactionId,
      withParent: undefined,
    };
    return this.service.list(user.sub, merged);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 }) // design §5.8 — 120/min read
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get one transaction (visibility-guarded)',
    description:
      'Returns the transaction iff the caller has at least one visible attribution ' +
      '(personal or via group membership). 404 otherwise — existence is not leaked.',
  })
  @ApiOkResponse({ description: 'Transaction summary', type: TransactionSummaryDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransactionSummaryDto> {
    return this.service.findByIdForUser(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 }) // design §5.8 — 30/min mutation
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update scalar fields and/or attribution subset of a transaction (creator only)',
    description:
      'Editable scalars: direction, amountCents, currency, occurredAt, categoryId, note. ' +
      'The optional `attributions` array replaces the caller-accessible subset; other users\u2019 ' +
      'personal attributions and non-member groups are never touched. An empty array clears all ' +
      'accessible attributions \u2014 if that leaves the transaction with zero attributions, the ' +
      'transaction is hard-deleted and the response is 204 No Content. Empty body is a no-op. ' +
      'For RECURRING parents, pass `?propagate=future|all` to cascade the non-period field ' +
      'deltas (amount/currency/category/note/direction/attributions) to child occurrences; ' +
      '`propagate=self` (default) edits the parent only. The schedule/period spec stays ' +
      'read-only here (deferred to 6.18.2).',
  })
  @ApiQuery({
    name: 'propagate',
    required: false,
    enum: ['self', 'future', 'all'],
    description:
      'Cascade scope for RECURRING parents. self=parent only (default), ' +
      'future=parent + children with occurredAt >= now, all=parent + every child. ' +
      'Ignored for non-RECURRING / childless transactions.',
  })
  @ApiBody({ type: UpdateTransactionDto })
  @ApiOkResponse({
    description: 'Updated transaction summary (self) or cascade-edit result envelope (future/all)',
    type: TransactionSummaryDto,
  })
  @ApiNoContentResponse({
    description: 'Transaction hard-deleted because the attribution edit left zero attributions.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Caller is not the creator' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransactionDto,
    @Query() query: UpdateTransactionQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionSummaryDto | CascadeEditResponseDto | undefined> {
    // When `propagate` is EXPLICITLY provided (self/future/all), route to the
    // cascade-aware edit path. This is the only path that permits editing a
    // RECURRING parent's non-period fields; for `self` it simply edits the
    // parent with zero children. When `propagate` is OMITTED we preserve the
    // legacy single-edit semantics (incl. attribution-empty → 204 delete and
    // the generated-occurrence guard) for full back-compat.
    if (query.propagate !== undefined) {
      return this.service.editTransactionWithPropagation(user.sub, id, dto, query.propagate);
    }
    const result = await this.service.update(user.sub, id, dto);
    if (result === null) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return result;
  }

  @CustomThrottle({ limit: 30, ttl: 60000 }) // design §5.8 — 30/min mutation
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Scoped-delete of attributions on a transaction',
    description:
      'Removes the caller-accessible attribution(s) matching `scope`. When scope is omitted, the ' +
      'service picks the only accessible attribution; if several exist, 409 TRANSACTION_SCOPE_AMBIGUOUS ' +
      'is returned with the list of accessible scopes. When the remove leaves the transaction with ' +
      'zero attributions, the transaction row is hard-deleted (cascade on stars / comments / ' +
      'documents / schedule / plan).',
  })
  @ApiQuery({ name: 'scope', required: false, example: 'personal' })
  @ApiOkResponse({ description: 'Attribution change result', type: AttributionChangeResultDto })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiConflictResponse({ description: 'Scope ambiguous or not attributed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteTransactionQueryDto,
  ): Promise<AttributionChangeResultDto> {
    return this.service.remove(user.sub, id, query);
  }

  @CustomThrottle({ limit: 60, ttl: 60000 }) // design §5.8 — 60/min for star toggles
  @UseGuards(JwtAuthGuard)
  @Post(':id/star')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Toggle starring for the current user',
    description:
      'Creates a TransactionStar row for the caller when absent, or removes it when present. ' +
      'Idempotent in the sense that two calls end up in the starting state. Visibility is ' +
      "gated by the shared predicate — 404 when the caller can't see the transaction.",
  })
  @ApiOkResponse({ description: 'Post-toggle state + star count', type: ToggleStarResponseDto })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (60/min)' })
  async toggleStar(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ToggleStarResponseDto> {
    return this.service.toggleStar(user.sub, id);
  }
}
