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
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { BudgetService } from './budget.service';
import { BudgetListResponseDto } from './dto/budget-list-response.dto';
import { BudgetResponseDto } from './dto/budget-response.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { ListBudgetsQueryDto } from './dto/list-budgets-query.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

/**
 * Phase 10 · Iteration 10.2 — Budget CRUD/archive endpoints (design §5).
 * Same throttle tiers as payments: 30/min mutations, 120/min reads.
 */
@ApiTags('Budgets')
@Controller('budgets')
export class BudgetController {
  constructor(private readonly service: BudgetService) {}

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a budget (spending target)',
    description:
      'Personal budgets belong to the caller; group budgets require the group ADMIN role. ' +
      'CUSTOM periods carry explicit startsAt/endsAt; repeating periods must not. ' +
      "Currency defaults to the owner's / group's defaultCurrency when omitted.",
  })
  @ApiBody({ type: CreateBudgetDto })
  @ApiCreatedResponse({ description: 'Budget created', type: BudgetResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed (scope / period / category)' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Group not found or not accessible' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBudgetDto,
  ): Promise<BudgetResponseDto> {
    return this.service.create(user.sub, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List budgets visible to the current user',
    description:
      'Cursor-paginated. Visibility union of personal (own) + all member groups. Use ' +
      '`scope=personal` or `scope=group:<id>` to narrow; archived budgets are hidden ' +
      'unless `includeArchived=true`.',
  })
  @ApiOkResponse({ description: 'Paginated budgets envelope', type: BudgetListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Requested group scope is not accessible' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListBudgetsQueryDto,
  ): Promise<BudgetListResponseDto> {
    return this.service.list(user.sub, query);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get one budget (visibility-guarded)',
    description:
      'Owner (personal) or any group member (group). 404 otherwise — existence is not leaked.',
  })
  @ApiOkResponse({ description: 'Budget', type: BudgetResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetResponseDto> {
    return this.service.findById(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a budget (owner / group admin)',
    description:
      'Editable: name, amountCents, currency, categoryId, period (+ CUSTOM bounds), ' +
      'alertThresholdPct, alertOverspend. Scope is immutable. Archived budgets reject ' +
      'edits with BUDGET_ARCHIVED — unarchive first.',
  })
  @ApiBody({ type: UpdateBudgetDto })
  @ApiOkResponse({ description: 'Updated budget', type: BudgetResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed (period / category)' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiConflictResponse({ description: 'Budget is archived' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetDto,
  ): Promise<BudgetResponseDto> {
    return this.service.update(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Hard-delete a budget (owner / group admin)',
    description: 'Alert events cascade. Allowed on archived budgets.',
  })
  @ApiNoContentResponse({ description: 'Budget deleted' })
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
    summary: 'Soft-archive a budget (owner / group admin)',
    description:
      'Archived budgets keep history, stop being evaluated, and are listed only with ' +
      '`includeArchived=true`. Archiving an already-archived budget yields 409 BUDGET_ARCHIVED.',
  })
  @ApiOkResponse({ description: 'Archived budget', type: BudgetResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiConflictResponse({ description: 'Budget is already archived' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async archive(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetResponseDto> {
    return this.service.archive(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unarchive a budget (owner / group admin)',
    description: 'Reverses archive. Idempotent — unarchiving an active budget is a no-op.',
  })
  @ApiOkResponse({ description: 'Unarchived budget', type: BudgetResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Group member without the admin role' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async unarchive(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetResponseDto> {
    return this.service.unarchive(user.sub, id);
  }
}
