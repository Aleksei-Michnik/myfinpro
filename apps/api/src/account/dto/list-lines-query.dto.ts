import { STATEMENT_LINE_STATUSES, type StatementLineStatus } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * The review queue's server-side filters (design §6.2). `needs_input` is the
 * union the review UI opens on: no suggestion the machine trusts (`none`) and
 * create proposals with no remembered category.
 */
export const STATEMENT_SUGGESTION_FILTERS = [
  'match',
  'transfer',
  'create',
  'none',
  'needs_input',
] as const;
export type StatementSuggestionFilter = (typeof STATEMENT_SUGGESTION_FILTERS)[number];

/** Query params for GET /accounts/:id/lines. */
export class ListLinesQueryDto {
  @ApiPropertyOptional({ enum: [...STATEMENT_LINE_STATUSES] })
  @IsOptional()
  @IsIn([...STATEMENT_LINE_STATUSES])
  status?: StatementLineStatus;

  @ApiPropertyOptional({ description: 'Only the lines of one import.' })
  @IsOptional()
  @IsUUID()
  importId?: string;

  @ApiPropertyOptional({
    enum: [...STATEMENT_SUGGESTION_FILTERS],
    description: 'Filter by what the matcher proposed — pagination-safe, evaluated in SQL.',
  })
  @IsOptional()
  @IsIn([...STATEMENT_SUGGESTION_FILTERS])
  suggestion?: StatementSuggestionFilter;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
