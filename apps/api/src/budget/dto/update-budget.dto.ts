import { BUDGET_PERIODS, CURRENCY_CODES, type BudgetPeriod } from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MAX_BUDGET_AMOUNT_CENTS } from './create-budget.dto';

/**
 * PATCH /budgets/:id body — Phase 10, iteration 10.2 (design §5).
 *
 * Every field is optional; omitted fields keep their current value.
 * Scope (scopeType / ownerId / groupId) is immutable — recreate the budget
 * to move it. Nullable fields (`categoryId`, `startsAt`, `endsAt`,
 * `alertThresholdPct`) accept an explicit `null` to clear
 * (`@IsOptional()` skips validation for null, so null passes through).
 * Semantic checks against the merged state live in BudgetService.update().
 */
export class UpdateBudgetDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ description: 'Target amount in minor units (cents).' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_BUDGET_AMOUNT_CENTS)
  amountCents?: number;

  @ApiPropertyOptional({ description: 'ISO 4217 code from the supported list.' })
  @IsOptional()
  @IsIn([...CURRENCY_CODES])
  currency?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the category narrowing.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ enum: [...BUDGET_PERIODS] })
  @IsOptional()
  @IsIn([...BUDGET_PERIODS])
  period?: BudgetPeriod;

  @ApiPropertyOptional({ nullable: true, description: 'CUSTOM only — ISO 8601 start.' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'CUSTOM only — ISO 8601 end (exclusive).' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    nullable: true,
    description: 'null disables the threshold alert.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  alertThresholdPct?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  alertOverspend?: boolean;
}
