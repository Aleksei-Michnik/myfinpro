import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentSummaryDto } from './payment-summary.dto';

/**
 * Response wrapper returned by `DELETE /payments/:id` (iteration 6.8).
 *
 * - `deletedAttributions`: number of PaymentAttribution rows removed.
 * - `addedAttributions`: 0 for DELETE; present for parity with the PATCH-
 *   attributions diff shape (used internally, surfaced to future callers).
 * - `paymentDeleted`: true iff the remove left the payment with zero
 *   attributions and the Payment row was hard-deleted.
 * - `payment`: fresh summary, or null when `paymentDeleted=true`.
 */
export class AttributionChangeResultDto {
  @ApiProperty() deletedAttributions!: number;
  @ApiProperty({ default: 0 }) addedAttributions!: number;
  @ApiProperty() paymentDeleted!: boolean;
  @ApiPropertyOptional({ type: () => PaymentSummaryDto, nullable: true })
  payment?: PaymentSummaryDto | null;
}
