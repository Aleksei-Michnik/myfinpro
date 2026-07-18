import { PRODUCT_IMAGE_MAX_COUNT, type ProductImageSize } from '@myfinpro/shared';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Phase 8.25 — ?size= rendition selector on the image GET endpoints. */
export class ProductImageSizeQueryDto {
  @ApiPropertyOptional({ enum: ['full', 'thumb'], default: 'full' })
  @IsOptional()
  @IsIn(['full', 'thumb'])
  size?: ProductImageSize;

  /**
   * Cache-busting token the web client appends so the browser refetches
   * when an image changes. Never interpreted by the server — declared
   * only because the global forbidNonWhitelisted pipe 400s otherwise
   * (8.25-hotfix-2).
   */
  @ApiPropertyOptional({ description: 'Cache-busting token; ignored by the server.' })
  @IsOptional()
  @IsString()
  v?: string;
}

/** Phase 8.25 — PATCH /products/:id/images/:imageId body. */
export class ReorderProductImageDto {
  @ApiProperty({ minimum: 1, maximum: PRODUCT_IMAGE_MAX_COUNT, description: '1 = primary.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRODUCT_IMAGE_MAX_COUNT)
  position!: number;
}
