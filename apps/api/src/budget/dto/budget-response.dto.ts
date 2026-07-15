import { BUDGET_PERIODS, type BudgetPeriod } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionCategorySummary } from '../../transaction/dto/transaction-summary.dto';

/**
 * Budget representation returned by every /budgets endpoint (Phase 10.2).
 *
 * The optional `category` embed reuses the compact category shape transactions
 * already expose so clients render both with one component. Progress is NOT
 * included here — it ships inline in iteration 10.5.
 */
export class BudgetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Target amount in minor units (cents).' }) amountCents!: number;
  @ApiProperty({ description: 'ISO 4217 three-letter code.' }) currency!: string;

  @ApiProperty({ enum: ['personal', 'group'] }) scopeType!: 'personal' | 'group';
  @ApiPropertyOptional({ nullable: true }) ownerId?: string | null;
  @ApiPropertyOptional({ nullable: true }) groupId?: string | null;

  @ApiPropertyOptional({ nullable: true }) categoryId?: string | null;
  @ApiPropertyOptional({ type: () => TransactionCategorySummary, nullable: true })
  category?: TransactionCategorySummary | null;

  @ApiProperty({ enum: [...BUDGET_PERIODS] }) period!: BudgetPeriod;
  @ApiPropertyOptional({ nullable: true, description: 'CUSTOM only (ISO 8601).' })
  startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'CUSTOM only (ISO 8601, exclusive).' })
  endsAt?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 100 })
  alertThresholdPct?: number | null;
  @ApiProperty() alertOverspend!: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Set when the budget is soft-archived.' })
  archivedAt?: string | null;

  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
