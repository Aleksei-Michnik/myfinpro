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
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ScheduleResponseDto } from './dto/schedule-response.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { PaymentScheduleService } from './payment-schedule.service';

/**
 * Phase 6, iteration 6.17.2 — `PaymentSchedule` REST surface.
 *
 * 1:1 with the parent payment, hence the singular `/schedule` path. Each
 * write mirrors into BullMQ via [`PaymentScheduleService`](apps/api/src/payment/payment-schedule.service.ts:1)
 * under a deterministic `payment-schedule:<id>` key.
 */
@ApiTags('Payment Schedules')
@Controller('payments/:paymentId/schedule')
export class PaymentScheduleController {
  constructor(private readonly service: PaymentScheduleService) {}

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a schedule for a RECURRING payment',
    description:
      'Mirrors into BullMQ via Queue.upsertJobScheduler under the deterministic key ' +
      '`payment-schedule:<id>`. Use PUT to replace an existing schedule — POST returns 409 ' +
      'PAYMENT_SCHEDULE_ALREADY_EXISTS in that case.',
  })
  @ApiBody({ type: CreateScheduleDto })
  @ApiCreatedResponse({ description: 'Schedule created', type: ScheduleResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed (cron / interval / endsAt)' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Parent payment not found or not visible' })
  @ApiConflictResponse({
    description: 'Schedule already exists, or parent payment is not RECURRING',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: CreateScheduleDto,
  ): Promise<ScheduleResponseDto> {
    return this.service.create(user.sub, paymentId, dto);
  }

  @CustomThrottle({ limit: 120, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Read the schedule attached to a payment' })
  @ApiOkResponse({ description: 'Schedule', type: ScheduleResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({
    description: 'Parent payment not visible, or no schedule attached',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120/min)' })
  async get(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<ScheduleResponseDto> {
    return this.service.get(user.sub, paymentId);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Replace the schedule (idempotent upsert)',
    description:
      'Re-upserts under the same `payment-schedule:<id>` key, so BullMQ replaces the prior ' +
      'scheduler entry atomically. Creates a row if none exists.',
  })
  @ApiBody({ type: UpdateScheduleDto })
  @ApiOkResponse({ description: 'Schedule (created or updated)', type: ScheduleResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Parent payment not found or not visible' })
  @ApiConflictResponse({ description: 'Parent payment is not RECURRING' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async replace(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<ScheduleResponseDto> {
    return this.service.replace(user.sub, paymentId, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete the schedule',
    description:
      'Removes both the DB row and the BullMQ scheduler entry. Already-fired child ' +
      'occurrences (history) are preserved per design.',
  })
  @ApiNoContentResponse({ description: 'Schedule deleted' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Parent payment not visible, or no schedule attached' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<void> {
    await this.service.remove(user.sub, paymentId);
  }

  // ── lifecycle (Phase 6.17.4) ──

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Pause the schedule (reversible)',
    description:
      'Sets pausedAt=NOW() and removes the BullMQ scheduler entry — no further occurrences ' +
      'fire until POST /resume. Idempotent: 409 PAYMENT_SCHEDULE_ALREADY_PAUSED on repeat. ' +
      '409 PAYMENT_SCHEDULE_CANCELLED when the schedule is already in the terminal cancelled state.',
  })
  @ApiOkResponse({ description: 'Schedule paused', type: ScheduleResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Parent payment not visible, or no schedule attached' })
  @ApiConflictResponse({ description: 'Already paused or cancelled' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async pause(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<ScheduleResponseDto> {
    return this.service.pause(user.sub, paymentId);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resume a paused schedule',
    description:
      'Clears pausedAt and re-upserts the BullMQ scheduler with the persisted spec. ' +
      'nextRunAt is recomputed from now via the shared computeNextRunAt helper. ' +
      '409 PAYMENT_SCHEDULE_NOT_PAUSED when active, PAYMENT_SCHEDULE_CANCELLED when terminal, ' +
      'PAYMENT_SCHEDULE_PAST_END when endsAt is in the past.',
  })
  @ApiOkResponse({ description: 'Schedule resumed', type: ScheduleResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Parent payment not visible, or no schedule attached' })
  @ApiConflictResponse({ description: 'Not paused, cancelled, or past endsAt' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async resume(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<ScheduleResponseDto> {
    return this.service.resume(user.sub, paymentId);
  }

  @CustomThrottle({ limit: 30, ttl: 60_000 })
  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel the schedule (terminal soft-cancel)',
    description:
      'Sets cancelledAt=NOW() and removes the BullMQ scheduler entry. Terminal: cannot be ' +
      'resumed (use POST /schedule to create a fresh one). The DB row is preserved so ' +
      'parentScheduleId provenance survives on already-fired child occurrences. Use DELETE ' +
      'to hard-remove the row.',
  })
  @ApiOkResponse({ description: 'Schedule cancelled', type: ScheduleResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Parent payment not visible, or no schedule attached' })
  @ApiConflictResponse({ description: 'Already cancelled' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (30/min)' })
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<ScheduleResponseDto> {
    return this.service.cancel(user.sub, paymentId);
  }
}
