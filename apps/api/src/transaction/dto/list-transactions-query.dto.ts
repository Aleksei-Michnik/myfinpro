import { TRANSACTION_DIRECTIONS, TRANSACTION_SORTS, TRANSACTION_TYPES } from '@myfinpro/shared';
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
 * Query params for GET /transactions (iteration 6.6).
 *
 * See design §5.2 "GET /transactions query" for semantics of each field.
 * Validation is applied here; additional semantic checks (group membership,
 * cursor round-trip) live in TransactionService.list().
 */
export class ListTransactionsQueryDto {
  /** Visibility scope. Default 'all' (personal + all member groups). */
  @ApiPropertyOptional({
    description: 'Scope filter: all | personal | group:<groupId>',
    example: 'all',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|personal|group:[a-zA-Z0-9-]{1,36})$/)
  scope?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_DIRECTIONS })
  @IsOptional()
  @IsIn([...TRANSACTION_DIRECTIONS])
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

  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn([...TRANSACTION_TYPES])
  type?: 'ONE_TIME' | 'RECURRING' | 'LIMITED_PERIOD' | 'INSTALLMENT' | 'LOAN' | 'MORTGAGE';

  /**
   * Iteration 6.18.1.3 — narrow to occurrences of a single recurring parent.
   *
   * When set, the listing is filtered to `parentTransactionId === <uuid>`.
   * Visibility on the **parent** is enforced (404 leak-free) so a non-member
   * can't enumerate children. Combined with `?withParent` it has no effect:
   * `parentTransactionId` is a strict identity filter, `withParent` is a
   * boolean partition.
   */
  @ApiPropertyOptional({
    description:
      'Narrow to occurrences of a single recurring parent. Caller must be able to see the parent; otherwise 404.',
  })
  @IsOptional()
  @IsUUID()
  parentTransactionId?: string;

  /**
   * Iteration 6.18.1.3 — partition the visible set into parents (`true`)
   * vs. occurrences (`false`). Omitted = both. Used by the /transactions page
   * filter UI shipping in 6.18.3 (`childScope`). Forward-compatible with
   * existing callers — when omitted, behaviour is unchanged.
   */
  @ApiPropertyOptional({
    description:
      'true → only parents (parentTransactionId === null); false → only occurrences (parentTransactionId !== null); omitted → both.',
    example: 'true',
  })
  @IsOptional()
  @IsBooleanString()
  withParent?: string;

  /** Free-text search against note (case-insensitive substring match). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_SORTS, default: 'date_desc' })
  @IsOptional()
  @IsIn([...TRANSACTION_SORTS])
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
