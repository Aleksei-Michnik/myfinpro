import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One composed line — a registry product × quantity × unit price. */
export class ManualReceiptItemDto {
  @ApiProperty({ description: 'Registry product (scanned or created inline).' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Positive; decimals allowed for weighed goods.' })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'Integer cents per unit.' })
  @IsInt()
  @Min(0)
  unitPriceCents!: number;
}

/**
 * POST /receipts/manual body (Phase 8.14) — a receipt composed by scanning
 * the products themselves. No extraction runs: the user IS the extractor,
 * so the receipt is born in REVIEW with items pre-linked.
 */
export class CreateManualReceiptDto {
  @ApiProperty({ description: 'ISO 4217 code.', example: 'ILS' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  merchantName?: string;

  @ApiPropertyOptional({ description: 'ISO 8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  purchasedAt?: string;

  @ApiProperty({ type: [ManualReceiptItemDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualReceiptItemDto)
  items!: ManualReceiptItemDto[];
}
