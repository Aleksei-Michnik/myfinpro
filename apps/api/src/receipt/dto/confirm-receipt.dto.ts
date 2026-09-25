import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AttributionDto } from '../../transaction/dto/attribution.dto';

/**
 * Phase 7.9 — POST /receipts/:id/confirm body.
 *
 * The receipt already carries the money fields (total, currency, purchase
 * date), the merchant, and the line items from review; confirmation only
 * needs the primary OUT category for the resulting transaction plus the
 * attribution scopes to remember (mirrors POST /transactions) — and, since
 * 20.6, optionally the account the money left.
 */
export class ConfirmReceiptDto {
  @ApiProperty({ description: 'Primary OUT category for the resulting transaction.' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ type: [AttributionDto], description: 'Attribution scopes (personal / group).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AttributionDto)
  attributions!: AttributionDto[];

  @ApiPropertyOptional({
    description: 'Transaction note; defaults to the merchant name when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Phase 20.6 — the account the money left. Must be visible, unarchived and in the ' +
      "receipt's currency; the resulting transaction is then auto-linked to the pending " +
      'statement line that confirms it, if there is exactly one.',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
