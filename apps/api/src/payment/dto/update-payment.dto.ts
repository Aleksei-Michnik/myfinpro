import { PAYMENT_DIRECTIONS } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

/**
 * PATCH /payments/:id body. Phase 6, iteration 6.7.
 *
 * Only **scalar** fields are accepted. Attribution array edits and star/comment
 * toggles are handled by dedicated endpoints (iterations 6.8 / 6.9 / 6.10).
 *
 * All fields are optional; an empty body is a no-op (no DB write, no audit).
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
}
