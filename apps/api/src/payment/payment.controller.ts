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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { DeletePaymentQueryDto } from './dto/delete-payment.query.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { PaymentListResponseDto } from './dto/payment-list-response.dto';
import { PaymentSummaryDto } from './dto/payment-summary.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentService } from './payment.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @CustomThrottle({ limit: 30, ttl: 60000 }) // design §5.8 — 30/min per caller
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a payment',
    description:
      'Only `type = "ONE_TIME"` is accepted in this iteration (6.5). RECURRING / LIMITED_PERIOD / ' +
      'INSTALLMENT / LOAN / MORTGAGE ship in iterations 6.17 and 6.19.',
  })
  @ApiBody({ type: CreatePaymentDto })
  @ApiCreatedResponse({ description: 'Payment created', type: PaymentSummaryDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Attribution out of scope (group non-member)' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentSummaryDto> {
    return this.service.create(user.sub, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 }) // design §5.8 — 120/min per caller
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List payments visible to the current user',
    description:
      'Cursor-paginated. Visibility union of personal (current user) + all groups the user is a ' +
      'member of. Use `scope=personal` or `scope=group:<id>` to narrow.',
  })
  @ApiOkResponse({ description: 'Paginated payments envelope', type: PaymentListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Requested group scope is not accessible' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaymentListResponseDto> {
    return this.service.list(user.sub, query);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 }) // design §5.8 — 120/min read
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get one payment (visibility-guarded)',
    description:
      'Returns the payment iff the caller has at least one visible attribution ' +
      '(personal or via group membership). 404 otherwise — existence is not leaked.',
  })
  @ApiOkResponse({ description: 'Payment summary', type: PaymentSummaryDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentSummaryDto> {
    return this.service.findByIdForUser(user.sub, id);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 }) // design §5.8 — 30/min mutation
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update scalar fields and/or attribution subset of a payment (creator only)',
    description:
      'Editable scalars: direction, amountCents, currency, occurredAt, categoryId, note. ' +
      'The optional `attributions` array replaces the caller-accessible subset; other users\u2019 ' +
      'personal attributions and non-member groups are never touched. An empty array clears all ' +
      'accessible attributions \u2014 if that leaves the payment with zero attributions, the ' +
      'payment is hard-deleted and the response is 204 No Content. Empty body is a no-op.',
  })
  @ApiBody({ type: UpdatePaymentDto })
  @ApiOkResponse({ description: 'Updated payment summary', type: PaymentSummaryDto })
  @ApiNoContentResponse({
    description: 'Payment hard-deleted because the attribution edit left zero attributions.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Caller is not the creator' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentSummaryDto | undefined> {
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
    summary: 'Scoped-delete of attributions on a payment',
    description:
      'Removes the caller-accessible attribution(s) matching `scope`. When scope is omitted, the ' +
      'service picks the only accessible attribution; if several exist, 409 PAYMENT_SCOPE_AMBIGUOUS ' +
      'is returned with the list of accessible scopes. When the remove leaves the payment with ' +
      'zero attributions, the payment row is hard-deleted (cascade on stars / comments / ' +
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
    @Query() query: DeletePaymentQueryDto,
  ): Promise<AttributionChangeResultDto> {
    return this.service.remove(user.sub, id, query);
  }
}
