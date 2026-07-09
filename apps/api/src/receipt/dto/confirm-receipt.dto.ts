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
import { AttributionDto } from '../../payment/dto/attribution.dto';

/**
 * Phase 7.9 — POST /receipts/:id/confirm body.
 *
 * The receipt already carries the money fields (total, currency, purchase
 * date), the merchant, and the line items from review; confirmation only
 * needs the primary OUT category for the resulting payment plus the
 * attribution scopes to remember (mirrors POST /payments).
 */
export class ConfirmReceiptDto {
  @ApiProperty({ description: 'Primary OUT category for the resulting payment.' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ type: [AttributionDto], description: 'Attribution scopes (personal / group).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AttributionDto)
  attributions!: AttributionDto[];

  @ApiPropertyOptional({ description: 'Payment note; defaults to the merchant name when omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
