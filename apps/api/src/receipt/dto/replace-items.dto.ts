import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** One line item in the PUT /receipts/:id/items replacement set. */
export class ReceiptItemInputDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  rawName!: string;

  @ApiProperty({ description: 'Positive; decimals allowed for weighed goods.' })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((o: ReceiptItemInputDto) => o.unitPriceCents !== null)
  @IsInt()
  @Min(0)
  unitPriceCents?: number | null;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  discountCents?: number;

  @ApiProperty({ minimum: 0, description: 'Line total AFTER discount.' })
  @IsInt()
  @Min(0)
  totalCents!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: ReceiptItemInputDto) => o.categoryId !== null)
  @IsUUID()
  categoryId?: string | null;
}

/**
 * PUT /receipts/:id/items body (Phase 7.8) — REVIEW-only full replacement.
 * Positions are assigned from array order (1-based). An empty array is
 * valid (the user removed every extracted line).
 */
export class ReplaceItemsDto {
  @ApiProperty({ type: [ReceiptItemInputDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemInputDto)
  items!: ReceiptItemInputDto[];
}
