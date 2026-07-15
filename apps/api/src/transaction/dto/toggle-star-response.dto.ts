import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for POST /transactions/:id/star (iteration 6.9).
 *
 * The endpoint toggles the caller's `TransactionStar` row; the DTO returns the
 * post-toggle state plus a cheap total so the UI can show "starred by N"
 * without a follow-up query.
 */
export class ToggleStarResponseDto {
  /** Final state for the caller after the toggle. */
  @ApiProperty({
    example: true,
    description: 'True if the caller has starred the transaction now.',
  })
  starred!: boolean;

  /** Total users who have starred this transaction after the toggle. */
  @ApiProperty({ example: 1, description: 'Total star count for the transaction.' })
  starCount!: number;
}
