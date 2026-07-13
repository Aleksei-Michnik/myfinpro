import { BUDGET_PERIODS, CURRENCY_CODES, type BudgetPeriod } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/** Same sanity cap payments apply to amountCents (design §5 "Validation rules"). */
export const MAX_BUDGET_AMOUNT_CENTS = 1e11;

/**
 * POST /budgets body — Phase 10, iteration 10.2 (design §5).
 *
 * Semantic checks that need DB context (group role, category scope +
 * direction, CUSTOM period bounds) live in BudgetService; this DTO covers
 * shape/range validation only.
 */
export class CreateBudgetDto {
  @ApiProperty({ example: 'Groceries', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({ description: 'Target amount in minor units (cents).', example: 80000 })
  @IsInt()
  @IsPositive()
  @Max(MAX_BUDGET_AMOUNT_CENTS)
  amountCents!: number;

  @ApiPropertyOptional({
    description:
      "ISO 4217 code from the supported list. Defaults to the owner's (personal) or " +
      "group's (group) defaultCurrency when omitted.",
    example: 'ILS',
  })
  @IsOptional()
  @IsIn([...CURRENCY_CODES])
  currency?: string;

  @ApiProperty({ enum: ['personal', 'group'], example: 'personal' })
  @IsIn(['personal', 'group'])
  scopeType!: 'personal' | 'group';

  @ApiPropertyOptional({ description: 'Required when scopeType=group; forbidden otherwise.' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({
    description: 'Optional narrowing to one OUT/BOTH category visible in the budget scope.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiProperty({ enum: [...BUDGET_PERIODS], example: 'MONTHLY' })
  @IsIn([...BUDGET_PERIODS])
  period!: BudgetPeriod;

  @ApiPropertyOptional({ description: 'CUSTOM only — ISO 8601 period start (inclusive).' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'CUSTOM only — ISO 8601 period end (exclusive).' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, nullable: true, example: 80 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  alertThresholdPct?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  alertOverspend?: boolean;
}
