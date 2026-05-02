import {
  Body,
  Controller,
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
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { CreatePaymentDto } from './dto/create-payment.dto';
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
    summary: 'Update scalar fields of a payment (creator only)',
    description:
      'Editable fields: direction, amountCents, currency, occurredAt, categoryId, note. ' +
      'Attribution array edits are handled by the delete-per-scope endpoint (iteration 6.8). ' +
      'Empty body is a no-op.',
  })
  @ApiBody({ type: UpdatePaymentDto })
  @ApiOkResponse({ description: 'Updated payment summary', type: PaymentSummaryDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Caller is not the creator' })
  @ApiNotFoundResponse({ description: 'Not found or not visible to the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentDto,
  ): Promise<PaymentSummaryDto> {
    return this.service.update(user.sub, id, dto);
  }
}
