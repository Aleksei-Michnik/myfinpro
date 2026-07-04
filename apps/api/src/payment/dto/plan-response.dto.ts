import type { AmortizationMethod, PaymentPlanKind, PaymentFrequency } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PaymentPlan } from '@prisma/client';

/**
 * One row of the amortisation table as served by GET /payments/:id/plan
 * (Phase 6, iteration 6.19). The math columns are recomputed from the plan
 * parameters (pure `calculateAmortization`); `occurrenceId` / `status` join
 * the pre-generated child Payment rows so the UI can render per-row state
 * (PENDING / POSTED / CANCELLED).
 */
export class PlanRowDto {
  @ApiProperty({ description: '1-based row index.' })
  index!: number;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  dueAt!: string;

  @ApiProperty()
  principalCents!: number;

  @ApiProperty()
  interestCents!: number;

  @ApiProperty()
  totalCents!: number;

  @ApiProperty({ description: 'Principal outstanding after this row.' })
  remainingCents!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Child Payment id backing this row (null if the row was hard-deleted).',
  })
  occurrenceId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Child Payment status (PENDING / POSTED / DUE / CANCELLED).',
  })
  status!: string | null;
}

/** Wire-level shape for a `PaymentPlan` row + its amortisation table. */
export class PlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  paymentId!: string;

  @ApiProperty({ enum: ['INSTALLMENT', 'LOAN', 'MORTGAGE'] })
  kind!: PaymentPlanKind;

  @ApiProperty()
  principalCents!: number;

  @ApiProperty({ description: 'Annual rate as a decimal fraction (0.05 = 5%).' })
  interestRate!: number;

  @ApiProperty()
  paymentsCount!: number;

  @ApiProperty({ enum: ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] })
  frequency!: PaymentFrequency;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  firstDueAt!: string;

  @ApiProperty({ enum: ['equal', 'french'] })
  amortizationMethod!: AmortizationMethod;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'ISO 8601 datetime — when the plan was cancelled via DELETE /plan. Terminal; null when active.',
  })
  cancelledAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [PlanRowDto] })
  rows!: PlanRowDto[];
}

/** Map a Prisma `PaymentPlan` row (sans amortisation table) onto the DTO. */
export function mapPlanRowToDto(row: PaymentPlan, rows: PlanRowDto[]): PlanResponseDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    kind: row.kind as PaymentPlanKind,
    principalCents: row.principalCents,
    interestRate: Number(row.interestRate),
    paymentsCount: row.paymentsCount,
    frequency: row.frequency as PaymentFrequency,
    firstDueAt: row.firstDueAt.toISOString(),
    amortizationMethod: row.amortizationMethod as AmortizationMethod,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    rows,
  };
}
