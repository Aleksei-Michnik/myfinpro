import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { CreateProductDto } from '../../product/dto/create-product.dto';

/**
 * Phase 8.4/8.5 — POST /receipts/:id/items/:itemId/match body.
 *
 * Exactly one of `productId` (link an existing registry product) or
 * `createProduct` (publish a new one and link it) — the service enforces
 * the XOR. `categoryId` optionally overrides the item's category in the
 * same call (the walkthrough's per-item category confirm).
 */
export class MatchItemDto {
  @ApiPropertyOptional({ description: 'Existing registry product to link.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    type: CreateProductDto,
    description: 'Create-and-link a new registry product.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateProductDto)
  createProduct?: CreateProductDto;

  @ApiPropertyOptional({ description: 'Override the item category (visible OUT category).' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
