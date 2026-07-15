import { ApiProperty } from '@nestjs/swagger';
import { TransactionSummaryDto } from './transaction-summary.dto';

/**
 * Response wrapper returned by `PATCH /transactions/:id?propagate=future|all`
 * (Phase 6 · Iteration 6.18.1.5).
 *
 * - `transaction`               — the updated parent summary.
 * - `affectedChildrenCount` — number of child occurrences updated in place.
 * - `skippedChildrenCount`  — number of child occurrences left untouched
 *                             because they carry an attribution to a group
 *                             the editor is NOT a member of (scope guard).
 */
export class CascadeEditResponseDto {
  @ApiProperty({ type: () => TransactionSummaryDto })
  transaction!: TransactionSummaryDto;

  @ApiProperty({ default: 0 })
  affectedChildrenCount!: number;

  @ApiProperty({ default: 0 })
  skippedChildrenCount!: number;
}
