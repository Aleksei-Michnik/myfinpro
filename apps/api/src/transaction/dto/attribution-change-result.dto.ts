import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionSummaryDto } from './transaction-summary.dto';

/**
 * Response wrapper returned by `DELETE /transactions/:id` (iteration 6.8).
 *
 * - `deletedAttributions`: number of TransactionAttribution rows removed.
 * - `addedAttributions`: 0 for DELETE; present for parity with the PATCH-
 *   attributions diff shape (used internally, surfaced to future callers).
 * - `transactionDeleted`: true iff the remove left the transaction with zero
 *   attributions and the Transaction row was hard-deleted.
 * - `transaction`: fresh summary, or null when `transactionDeleted=true`.
 */
export class AttributionChangeResultDto {
  @ApiProperty() deletedAttributions!: number;
  @ApiProperty({ default: 0 }) addedAttributions!: number;
  @ApiProperty() transactionDeleted!: boolean;
  @ApiPropertyOptional({ type: () => TransactionSummaryDto, nullable: true })
  transaction?: TransactionSummaryDto | null;
}
