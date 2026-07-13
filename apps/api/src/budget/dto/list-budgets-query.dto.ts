import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Query params for GET /budgets — Phase 10, iteration 10.2 (design §5).
 *
 * Mirrors the GET /payments scope grammar (`all | personal | group:<id>`)
 * and cursor-pagination knobs so clients reuse the same query-building code.
 */
export class ListBudgetsQueryDto {
  /** Visibility scope. Default 'all' (personal + all member groups). */
  @ApiPropertyOptional({
    description: 'Scope filter: all | personal | group:<groupId>',
    example: 'all',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|personal|group:[a-zA-Z0-9-]{1,36})$/)
  scope?: string;

  /** 'true' includes archived budgets; default hides them (design §3). */
  @ApiPropertyOptional({ example: 'false' })
  @IsOptional()
  @IsBooleanString()
  includeArchived?: string;

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
