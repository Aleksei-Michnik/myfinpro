import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Query params for GET /accounts — Phase 20, iteration 20.2 (design §6.1).
 *
 * Same scope grammar (`all | personal | group:<id>`) and cursor knobs as
 * GET /budgets and GET /transactions, so clients reuse their query builders.
 */
export class ListAccountsQueryDto {
  /** Visibility scope. Default 'all' (personal + all member groups). */
  @ApiPropertyOptional({
    description: 'Scope filter: all | personal | group:<groupId>',
    example: 'all',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|personal|group:[a-zA-Z0-9-]{1,36})$/)
  scope?: string;

  /** 'true' includes archived accounts; default hides them. */
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
