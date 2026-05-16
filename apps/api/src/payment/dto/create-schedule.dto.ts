import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Production-default minimum allowed `everyMs` value (1 minute) — keeps
 * abusive sub-second schedulers off Redis. Iteration 6.17.3 made the
 * effective floor configurable via the `PAYMENT_SCHEDULE_MIN_INTERVAL_MS`
 * env var (read by `PaymentScheduleService`) so integration tests can drop
 * it to ~100 ms while production keeps the 60 s floor.
 *
 * The cap (≤ 365 days) prevents nonsensical "every 100 years" specs from
 * sitting in the DB.
 */
export const SCHEDULE_EVERY_MS_MIN = 60_000;
export const SCHEDULE_EVERY_MS_MAX = 365 * 24 * 60 * 60 * 1000;

/**
 * DTO-level absolute floor — the actual policy floor is enforced by
 * `PaymentScheduleService` against `PAYMENT_SCHEDULE_MIN_INTERVAL_MS`. We
 * still reject ≤ 0 here so the wire-level type contract (positive integer)
 * is honoured before the request reaches the service.
 */
export const SCHEDULE_EVERY_MS_DTO_MIN = 1;

/**
 * Lightweight cron sanity regex. Matches 5- or 6-field crons where each field
 * is composed of digits / `*` / `,` / `-` / `/` / `?` / `L` / `W` / `#`.
 * BullMQ does the authoritative validation when the spec is upserted; this
 * regex is a 400-friendly pre-flight to avoid round-tripping obviously-bad
 * input through Redis.
 */
export const CRON_SANITY_REGEX = /^(\s*[\d*?,\-/LW#]+){5,6}\s*$/;

/**
 * POST /payments/:paymentId/schedule body. Iteration 6.17.2.
 *
 * Exactly one of `cron` / `everyMs` must be present — enforced by the service
 * (DTO validators only handle field-level shape so we keep the cross-field
 * check inside `PaymentScheduleService.dtoToRepeatOpts`).
 */
export class CreateScheduleDto {
  @ApiPropertyOptional({
    description: 'Standard 5- or 6-field cron expression. Mutually exclusive with everyMs.',
    example: '0 9 * * *',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(CRON_SANITY_REGEX, { message: 'cron must be a valid 5- or 6-field cron expression' })
  cron?: string;

  @ApiPropertyOptional({
    description: `Fixed interval in milliseconds. Min ${SCHEDULE_EVERY_MS_MIN} (1 minute). Mutually exclusive with cron.`,
    example: 86_400_000,
  })
  @IsOptional()
  @IsInt()
  @Min(SCHEDULE_EVERY_MS_DTO_MIN)
  @Max(SCHEDULE_EVERY_MS_MAX)
  everyMs?: number;

  @ApiPropertyOptional({
    description: 'ISO 8601 datetime — when the scheduler starts firing. Defaults to now.',
    example: '2026-05-16T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 datetime — when the scheduler stops. Must be > startsAt.',
    example: '2027-05-16T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of times the scheduler should fire. Min 1.',
    example: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
