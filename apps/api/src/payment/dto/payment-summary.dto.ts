import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Compact category embed used in payment responses. */
export class PaymentCategorySummary {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) icon?: string | null;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;
}

/** Compact attribution embed — one row per (user|group) target of a payment. */
export class PaymentAttributionSummary {
  @ApiProperty({ enum: ['personal', 'group'] }) scope!: 'personal' | 'group';
  @ApiPropertyOptional({ nullable: true }) userId?: string | null;
  @ApiPropertyOptional({ nullable: true }) groupId?: string | null;
  @ApiPropertyOptional({ nullable: true }) groupName?: string | null;
}

/**
 * Compact payment representation returned by POST /payments (iteration 6.5) and
 * by the list endpoint introduced in 6.6.
 *
 * `commentCount`, `starredByMe`, `hasDocuments` default to 0 / false until the
 * corresponding features ship (iterations 6.14 / 6.15 / 6.16).
 */
export class PaymentSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['IN', 'OUT'] }) direction!: 'IN' | 'OUT';
  // Kept as a plain string (not enum) so future PAYMENT_TYPES additions don't churn the OpenAPI doc.
  @ApiProperty() type!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() occurredAt!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: () => PaymentCategorySummary }) category!: PaymentCategorySummary;
  @ApiProperty({ type: [PaymentAttributionSummary] }) attributions!: PaymentAttributionSummary[];
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
  @ApiProperty({ default: 0 }) commentCount!: number;
  @ApiProperty({ default: false }) starredByMe!: boolean;
  @ApiProperty({ default: false }) hasDocuments!: boolean;
  @ApiPropertyOptional({ nullable: true }) parentPaymentId?: string | null;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
