import { PAYMENT_DIRECTIONS, PAYMENT_SORTS, PAYMENT_TYPES } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Query params for GET /payments (iteration 6.6).
 *
 * See design §5.2 "GET /payments query" for semantics of each field.
 * Validation is applied here; additional semantic checks (group membership,
 * cursor round-trip) live in PaymentService.list().
 */
export class ListPaymentsQueryDto {
  /** Visibility scope. Default 'all' (personal + all member groups). */
  @ApiPropertyOptional({
    description: 'Scope filter: all | personal | group:<groupId>',
    example: 'all',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|personal|group:[a-zA-Z0-9-]{1,36})$/)
  scope?: string;

  @ApiPropertyOptional({ enum: PAYMENT_DIRECTIONS })
  @IsOptional()
  @IsIn([...PAYMENT_DIRECTIONS])
  direction?: 'IN' | 'OUT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Inclusive ISO-8601 lower bound on occurredAt. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Exclusive ISO-8601 upper bound on occurredAt. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** 'true' / 'false' as string per HTTP query convention. */
  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  starred?: string;

  @ApiPropertyOptional({ enum: PAYMENT_TYPES })
  @IsOptional()
  @IsIn([...PAYMENT_TYPES])
  type?: 'ONE_TIME' | 'RECURRING' | 'LIMITED_PERIOD' | 'INSTALLMENT' | 'LOAN' | 'MORTGAGE';

  /** Free-text search against note (case-insensitive substring match). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @ApiPropertyOptional({ enum: PAYMENT_SORTS, default: 'date_desc' })
  @IsOptional()
  @IsIn([...PAYMENT_SORTS])
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Opaque base64url cursor from a previous page's `nextCursor`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
