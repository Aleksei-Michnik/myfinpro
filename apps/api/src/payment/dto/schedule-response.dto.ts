import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Wire-level shape for a `PaymentSchedule` row. Iteration 6.17.2.
 *
 * `pausedAt` / `cancelledAt` are intentionally omitted — the columns ship in
 * 6.17.2 for forward-compat but the lifecycle endpoints land in 6.17.4. We
 * don't expose fields whose semantics aren't yet defined.
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

  @ApiProperty({ description: 'ISO 8601 datetime' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  updatedAt!: string;
}
