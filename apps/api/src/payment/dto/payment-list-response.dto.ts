import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentSummaryDto } from './payment-summary.dto';

/**
 * Paginated envelope for GET /payments (iteration 6.6).
 *
 * See design §5.3 — cursor-based pagination; `nextCursor` is an opaque
 * base64url-encoded JSON payload that the client echoes back verbatim.
 */
export class PaymentListResponseDto {
  @ApiProperty({ type: [PaymentSummaryDto] })
  data!: PaymentSummaryDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opaque cursor for the next page, null when no more pages.',
  })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
