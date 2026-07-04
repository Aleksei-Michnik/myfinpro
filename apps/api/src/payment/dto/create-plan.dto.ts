import {
  AMORTIZATION_METHODS,
  PAYMENT_FREQUENCIES,
  type AmortizationMethod,
  type PaymentFrequency,
} from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Hard ceiling on plan length — 600 periods covers a 50-year monthly
 * mortgage; anything longer is almost certainly a client bug and would
 * pre-generate an absurd number of occurrence rows.
 */
export const PLAN_PAYMENTS_COUNT_MAX = 600;

/**
 * Inline plan body accepted by `POST /payments` when
 * `type ∈ {INSTALLMENT, LOAN, MORTGAGE}` (Phase 6, iteration 6.19).
 *
 * The plan's principal is the payment's own `amountCents` — there is
 * deliberately NO separate principal field, so the two can never diverge.
 * The plan kind is the payment `type` itself, for the same reason.
 */
export class CreatePlanDto {
  @ApiProperty({
    description:
      'Annual interest rate as a decimal fraction (0.05 = 5%). Must be 0 for the equal method.',
    example: 0.05,
    minimum: 0,
    maximum: 1,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  interestRate!: number;

  @ApiProperty({
    description: 'Number of repayment occurrences to pre-generate.',
    example: 60,
    minimum: 1,
    maximum: PLAN_PAYMENTS_COUNT_MAX,
  })
  @IsInt()
  @Min(1)
  @Max(PLAN_PAYMENTS_COUNT_MAX)
  paymentsCount!: number;

  @ApiProperty({ enum: [...PAYMENT_FREQUENCIES], example: 'MONTHLY' })
  @IsIn([...PAYMENT_FREQUENCIES])
  frequency!: PaymentFrequency;

  @ApiProperty({
    description: 'Due date of the first repayment (ISO 8601). May be in the past for back-fills.',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsISO8601()
  firstDueAt!: string;

  @ApiPropertyOptional({
    enum: [...AMORTIZATION_METHODS],
    description:
      "Defaults by kind: INSTALLMENT → 'equal' (zero-interest), LOAN / MORTGAGE → 'french'.",
  })
  @IsOptional()
  @IsIn([...AMORTIZATION_METHODS])
  amortizationMethod?: AmortizationMethod;
}
