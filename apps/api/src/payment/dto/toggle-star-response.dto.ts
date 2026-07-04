import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for POST /payments/:id/star (iteration 6.9).
 *
 * The endpoint toggles the caller's `PaymentStar` row; the DTO returns the
 * post-toggle state plus a cheap total so the UI can show "starred by N"
 * without a follow-up query.
 */
export class ToggleStarResponseDto {
  /** Final state for the caller after the toggle. */
  @ApiProperty({ example: true, description: 'True if the caller has starred the payment now.' })
  starred!: boolean;

  /** Total users who have starred this payment after the toggle. */
  @ApiProperty({ example: 1, description: 'Total star count for the payment.' })
  starCount!: number;
}
