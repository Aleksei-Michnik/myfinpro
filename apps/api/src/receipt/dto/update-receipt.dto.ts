import { CURRENCY_CODES } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * PATCH /receipts/:id body (Phase 7.8) — REVIEW-only header corrections.
 * Every field is optional; an explicit `null` clears the nullable column
 * (hence the `ValidateIf` guards — `@IsOptional` alone rejects null).
 * Items are edited via PUT /receipts/:id/items; linking/creating the
 * registry merchant happens at confirm time (7.9) — review edits only fix
 * the extracted merchant TEXT or pin an existing registry entry.
 */
export class UpdateReceiptDto {
  @ApiPropertyOptional({ nullable: true, description: 'Corrected merchant name as printed.' })
  @IsOptional()
  @ValidateIf((o: UpdateReceiptDto) => o.extractedMerchantName !== null)
  @IsString()
  @MaxLength(200)
  extractedMerchantName?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Link an existing registry merchant.' })
  @IsOptional()
  @ValidateIf((o: UpdateReceiptDto) => o.merchantId !== null)
  @IsUUID()
  merchantId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ISO 8601 datetime.' })
  @IsOptional()
  @ValidateIf((o: UpdateReceiptDto) => o.purchasedAt !== null)
  @IsISO8601()
  purchasedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: [...CURRENCY_CODES] })
  @IsOptional()
  @ValidateIf((o: UpdateReceiptDto) => o.currency !== null)
  @IsIn([...CURRENCY_CODES])
  currency?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((o: UpdateReceiptDto) => o.totalCents !== null)
  @IsInt()
  @Min(0)
  totalCents?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'Receipt-level discount.' })
  @IsOptional()
  @ValidateIf((o: UpdateReceiptDto) => o.discountCents !== null)
  @IsInt()
  @Min(0)
  discountCents?: number | null;
}
