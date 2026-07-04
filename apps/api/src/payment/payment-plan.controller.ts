import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { PlanResponseDto } from './dto/plan-response.dto';
import { PaymentPlanService } from './payment-plan.service';

/**
 * Phase 6, iteration 6.19 — `PaymentPlan` REST surface.
 *
 * 1:1 with the parent payment, hence the singular `/plan` path (mirrors the
 * 6.17.2 schedule sub-resource). Creation is INLINE on `POST /payments`
 * (plan body + `type ∈ {INSTALLMENT, LOAN, MORTGAGE}`) — a plan parent
 * without its occurrence rows would be a broken invariant, so there is no
 * two-step create here. PATCH (regenerate) is deferred to a later iteration.
 */
@ApiTags('Payment Plans')
@Controller('payments/:paymentId/plan')
export class PaymentPlanController {
  constructor(private readonly service: PaymentPlanService) {}

  @CustomThrottle({ limit: 60, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the plan + amortisation table',
    description:
      'Returns plan metadata plus the full amortisation schedule. Math columns are recomputed ' +
      'from the persisted parameters; each row joins its pre-generated child Payment ' +
      '(occurrenceId + status) so clients can render per-row state. Visible to any user with ' +
      'access to the parent payment.',
  })
  @ApiOkResponse({ description: 'Plan with amortisation rows', type: PlanResponseDto })
  @ApiNotFoundResponse({ description: 'Payment not visible or has no plan' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async get(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ): Promise<PlanResponseDto> {
    return this.service.get(user.sub, paymentId);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel the plan (terminal)',
    description:
      'Creator-only. Stamps cancelledAt and flips the remaining PENDING child occurrences to ' +
      'CANCELLED — rows are never deleted, for audit. Returns the updated plan. ' +
      '409 PAYMENT_PLAN_ALREADY_CANCELLED on repeat.',
  })
  @ApiOkResponse({ description: 'Plan cancelled', type: PlanResponseDto })
  @ApiNotFoundResponse({ description: 'Payment not owned by caller or has no plan' })
  @ApiConflictResponse({ description: 'Plan already cancelled' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid JWT' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited' })
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ): Promise<PlanResponseDto> {
    return this.service.cancel(user.sub, paymentId);
  }
}
