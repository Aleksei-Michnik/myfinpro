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
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { AccountService } from './account.service';
import { AccountListResponseDto } from './dto/account-list-response.dto';
import { AccountResponseDto } from './dto/account-response.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

/**
 * Phase 20 · Iteration 20.2 — /accounts CRUD + archive (design §6.1).
 * Same throttle tiers as budgets and transactions: 30/min mutations,
 * 120/min reads.
 */
@ApiTags('Accounts')
@Controller('accounts')
export class AccountController {
  constructor(private readonly service: AccountService) {}

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create an account (bank, card, cash or other)',
    description:
      'Personal accounts belong to the caller; group accounts require the group ADMIN role. ' +
      "Currency defaults to the owner's / group's defaultCurrency and is immutable afterwards. " +
      'CARD accounts may carry a billing BANK account (same scope + currency) and a billing day.',
  })
  @ApiBody({ type: CreateAccountDto })
  @ApiCreatedResponse({ description: 'Account created', type: AccountResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed (scope / institution / billing)' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Group not found or not accessible' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.service.create(user.sub, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List accounts visible to the current user',
    description:
      'Cursor-paginated. Visibility union of personal (own) + all member groups. Use ' +
      '`scope=personal` or `scope=group:<id>` to narrow; archived accounts are hidden ' +
      'unless `includeArchived=true`. Ledger balances are derived per page, never stored.',
  })
  @ApiOkResponse({ description: 'Paginated accounts envelope', type: AccountListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Requested group scope is not accessible' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListAccountsQueryDto,
  ): Promise<AccountListResponseDto> {
    return this.service.list(user.sub, query);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get one account (visibility-guarded)',
    description:
      'Owner (personal) or any group member (group). 404 otherwise — existence is not leaked.',
  })
  @ApiOkResponse({ description: 'Account', type: AccountResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    return this.service.findById(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update an account (owner / group admin)',
    description:
      'Editable: name, institution, last4, color, opening balance + date, reported balance + ' +
      'date, billing account + day. Scope and currency are immutable (ACCOUNT_INVALID_SCOPE). ' +
      'Archived accounts reject edits with ACCOUNT_ARCHIVED — unarchive first.',
  })
  @ApiBody({ type: UpdateAccountDto })
  @ApiOkResponse({ description: 'Updated account', type: AccountResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed (scope / institution / billing)' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiConflictResponse({ description: 'Account is archived' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.service.update(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Hard-delete an account (owner / group admin)',
    description:
      'Transactions keep their amounts with accountId / transferAccountId SetNull; imports and ' +
      'statement lines cascade. Allowed on archived accounts.',
  })
  @ApiNoContentResponse({ description: 'Account deleted' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Soft-archive an account (owner / group admin)',
    description:
      'Archived accounts keep their history and balances but stop accepting new transactions, ' +
      'and are listed only with `includeArchived=true`. Archiving twice yields 409 ' +
      'ACCOUNT_ARCHIVED.',
  })
  @ApiOkResponse({ description: 'Archived account', type: AccountResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiConflictResponse({ description: 'Account is already archived' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async archive(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    return this.service.archive(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unarchive an account (owner / group admin)',
    description: 'Reverses archive. Idempotent — unarchiving an active account is a no-op.',
  })
  @ApiOkResponse({ description: 'Unarchived account', type: AccountResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async unarchive(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    return this.service.unarchive(user.sub, id);
  }
}
