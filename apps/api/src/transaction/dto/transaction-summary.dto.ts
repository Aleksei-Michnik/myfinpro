import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Compact category embed used in transaction responses. */
export class TransactionCategorySummary {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) icon?: string | null;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;
}

/** Compact attribution embed — one row per (user|group) target of a transaction. */
export class TransactionAttributionSummary {
  @ApiProperty({ enum: ['personal', 'group'] }) scope!: 'personal' | 'group';
  @ApiPropertyOptional({ nullable: true }) userId?: string | null;
  @ApiPropertyOptional({ nullable: true }) groupId?: string | null;
  @ApiPropertyOptional({ nullable: true }) groupName?: string | null;
}

/**
 * Compact transaction representation returned by POST /transactions (iteration 6.5) and
 * by the list endpoint introduced in 6.6.
 *
 * `commentCount`, `starredByMe`, `hasDocuments` default to 0 / false until the
 * corresponding features ship (iterations 6.14 / 6.15 / 6.16).
 */
export class TransactionSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['IN', 'OUT'] }) direction!: 'IN' | 'OUT';
  // Kept as a plain string (not enum) so future TRANSACTION_TYPES additions don't churn the OpenAPI doc.
  @ApiProperty() type!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() occurredAt!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: () => TransactionCategorySummary }) category!: TransactionCategorySummary;
  @ApiProperty({ type: [TransactionAttributionSummary] })
  attributions!: TransactionAttributionSummary[];
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
  @ApiProperty({ default: 0 }) commentCount!: number;
  @ApiProperty({ default: false }) starredByMe!: boolean;
  @ApiProperty({ default: false }) hasDocuments!: boolean;
  /** Source receipt when the transaction came from confirming one (7.13); loaded on the detail endpoint. */
  @ApiPropertyOptional({ nullable: true }) receiptId?: string | null;
  @ApiPropertyOptional({ nullable: true }) parentTransactionId?: string | null;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
