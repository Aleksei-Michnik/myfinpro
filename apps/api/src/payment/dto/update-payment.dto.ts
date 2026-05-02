import { PAYMENT_DIRECTIONS } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
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
 * PATCH /payments/:id body. Phase 6, iterations 6.7 + 6.8.
 *
 * All fields are optional; an empty body is a no-op (no DB write, no audit).
 *
 * Iteration 6.8 adds `attributions`: when present, the caller-accessible
 * attribution subset is *replaced* by the given list. Other users' personal
 * attributions and non-member groups are never touched. An empty array is
 * equivalent to `DELETE ?scope=all` and hard-deletes the payment when it
 * removes the last attribution (→ 204 No Content).
 */
export class UpdatePaymentDto {
  @ApiPropertyOptional({ enum: [...PAYMENT_DIRECTIONS] })
  @IsOptional()
  @IsIn([...PAYMENT_DIRECTIONS])
  direction?: 'IN' | 'OUT';

  @ApiPropertyOptional({ description: 'Amount in minor units (cents).' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountCents?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ example: '2026-04-25' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Pass empty string to clear.' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;

  @ApiPropertyOptional({
    type: [AttributionDto],
    description:
      'Replaces the caller-accessible attributions. Non-accessible attributions are untouched. ' +
      'Empty array deletes every accessible attribution (same as DELETE ?scope=all). ' +
      'Creator-only.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttributionDto)
  attributions?: AttributionDto[];
}
