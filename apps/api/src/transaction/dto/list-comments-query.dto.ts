import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query for `GET /transactions/:transactionId/comments`.
 *
 * Cursor-paginated — oldest-first (createdAt ASC, id ASC tiebreaker).
 * `cursor` is an opaque base64url blob produced by the server.
 */
export class ListCommentsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Opaque base64url cursor. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
