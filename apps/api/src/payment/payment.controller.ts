import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { PaymentSummaryDto } from './dto/payment-summary.dto';
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
}
