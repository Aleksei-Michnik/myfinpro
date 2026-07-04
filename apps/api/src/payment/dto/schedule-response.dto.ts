import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Wire-level shape for a `PaymentSchedule` row.
 *
 * Iteration 6.17.2 introduced the columns; 6.17.4 lit up `pausedAt` /
 * `cancelledAt` once the lifecycle endpoints (POST /pause | /resume |
 * /cancel) defined their semantics. `pausedAt !== null` means the
 * scheduler entry has been removed from BullMQ; `cancelledAt !== null`
 * means the schedule is terminal — only DELETE can purge the row.
 */
export class ScheduleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  paymentId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  cron!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  everyMs!: number | null;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  startsAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'ISO 8601 datetime' })
  endsAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  limit!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'ISO 8601 datetime' })
  nextRunAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'ISO 8601 datetime' })
  lastRunAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'ISO 8601 datetime — when the schedule was paused via POST /pause. Null when active.',
  })
  pausedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'ISO 8601 datetime — when the schedule was soft-cancelled via POST /cancel. ' +
      'Terminal: cannot be resumed. Null when not cancelled.',
  })
  cancelledAt!: string | null;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  updatedAt!: string;
}
