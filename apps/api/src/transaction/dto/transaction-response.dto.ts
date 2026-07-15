import { TransactionSummaryDto } from './transaction-summary.dto';

/**
 * Full transaction detail shape returned by GET /transactions/:id (iteration 6.7).
 *
 * Identical to `TransactionSummaryDto` for now; iteration 6.7 extends it with
 * `schedule`, `plan`, and `documents` sub-objects.
 */
export class TransactionResponseDto extends TransactionSummaryDto {}
