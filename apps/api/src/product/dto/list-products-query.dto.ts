import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 8.2 — GET /products query. With `search`: ranked global-registry
 * matches (top N, no cursor). Without: the caller's purchased products,
 * newest purchase first, cursor-paginated (design §3).
 */
export class ListProductsQueryDto {
  @ApiPropertyOptional({ description: 'Registry search — any recorded language, or a barcode.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
