import { PaymentSummaryDto } from './payment-summary.dto';

/**
 * Full payment detail shape returned by GET /payments/:id (iteration 6.7).
 *
 * Identical to `PaymentSummaryDto` for now; iteration 6.7 extends it with
 * `schedule`, `plan`, and `documents` sub-objects.
 */
export class PaymentResponseDto extends PaymentSummaryDto {}
