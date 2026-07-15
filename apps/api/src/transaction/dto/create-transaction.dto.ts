import { TRANSACTION_DIRECTIONS, TRANSACTION_TYPES } from '@myfinpro/shared';
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
import { CreatePlanDto } from './create-plan.dto';

/**
 * POST /transactions body. Phase 6, iteration 6.5.
 *
 * Only `type = 'ONE_TIME'` is accepted today. Other TRANSACTION_TYPES values are allowed
 * by the DTO so later iterations (6.17 RECURRING / 6.19 INSTALLMENT) can reuse this
 * file without a rename; the service rejects them with TRANSACTION_TYPE_NOT_IMPLEMENTED.
 */
export class CreateTransactionDto {
  @ApiProperty({ enum: [...TRANSACTION_DIRECTIONS], example: 'OUT' })
  @IsIn([...TRANSACTION_DIRECTIONS])
  direction!: 'IN' | 'OUT';

  @ApiProperty({ enum: [...TRANSACTION_TYPES], example: 'ONE_TIME' })
  @IsIn([...TRANSACTION_TYPES])
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
   * Rejected in 6.5 with TRANSACTION_SCHEDULE_NOT_SUPPORTED when present.
   */
  @ApiPropertyOptional({ description: 'Reserved — rejected in iteration 6.5.' })
  @IsOptional()
  schedule?: unknown;

  /**
   * Inline plan body — REQUIRED when `type ∈ {INSTALLMENT, LOAN, MORTGAGE}`
   * (iteration 6.19), rejected with TRANSACTION_PLAN_NOT_SUPPORTED otherwise.
   * The plan's principal is this transaction's `amountCents`; its kind is `type`.
   */
  @ApiPropertyOptional({ type: CreatePlanDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePlanDto)
  plan?: CreatePlanDto;
}
