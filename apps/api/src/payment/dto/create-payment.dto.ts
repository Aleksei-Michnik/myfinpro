import { PAYMENT_DIRECTIONS, PAYMENT_TYPES } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AttributionDto } from './attribution.dto';

/**
 * POST /payments body. Phase 6, iteration 6.5.
 *
 * Only `type = 'ONE_TIME'` is accepted today. Other PAYMENT_TYPES values are allowed
 * by the DTO so later iterations (6.17 RECURRING / 6.19 INSTALLMENT) can reuse this
 * file without a rename; the service rejects them with PAYMENT_TYPE_NOT_IMPLEMENTED.
 */
export class CreatePaymentDto {
  @ApiProperty({ enum: [...PAYMENT_DIRECTIONS], example: 'OUT' })
  @IsIn([...PAYMENT_DIRECTIONS])
  direction!: 'IN' | 'OUT';

  @ApiProperty({ enum: [...PAYMENT_TYPES], example: 'ONE_TIME' })
  @IsIn([...PAYMENT_TYPES])
  type!: 'ONE_TIME' | 'RECURRING' | 'LIMITED_PERIOD' | 'INSTALLMENT' | 'LOAN' | 'MORTGAGE';

  @ApiProperty({ description: 'Amount in minor units (cents).', example: 1250 })
  @IsInt()
  @IsPositive()
  amountCents!: number;

  @ApiProperty({ description: 'ISO 4217 three-letter code.', example: 'USD' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @ApiProperty({ description: 'ISO 8601 date or datetime.', example: '2026-04-25' })
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ description: 'Optional free-text note.' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;

  @ApiProperty({ type: [AttributionDto], description: 'Must be non-empty.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttributionDto)
  attributions!: AttributionDto[];

  /**
   * Reserved — schedule body for RECURRING / LIMITED_PERIOD (iteration 6.17).
   * Rejected in 6.5 with PAYMENT_SCHEDULE_NOT_SUPPORTED when present.
   */
  @ApiPropertyOptional({ description: 'Reserved — rejected in iteration 6.5.' })
  @IsOptional()
  schedule?: unknown;

  /**
   * Reserved — plan body for INSTALLMENT / LOAN / MORTGAGE (iteration 6.19).
   * Rejected in 6.5 with PAYMENT_PLAN_NOT_SUPPORTED when present.
   */
  @ApiPropertyOptional({ description: 'Reserved — rejected in iteration 6.5.' })
  @IsOptional()
  plan?: unknown;
}
