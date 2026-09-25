import { STATEMENT_SUGGESTED_ACTIONS, type StatementSuggestedAction } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TransactionCategorySummary,
  TransactionSummaryDto,
} from '../../transaction/dto/transaction-summary.dto';

/** One alternative the reviewer can pick instead of the proposal. */
export class StatementCandidateDto {
  @ApiProperty({ type: TransactionSummaryDto }) transaction!: TransactionSummaryDto;
  @ApiProperty({ description: 'Score in [0, 1.1] — design §5.2.' }) score!: number;
}

/**
 * The matcher's proposal for a pending line, RESOLVED for the review UI
 * (design §6.2). The stored snapshot holds ids and scores only; the list
 * endpoint resolves transactions and categories in one batched query per
 * page, never per line.
 */
export class StatementSuggestionDto {
  @ApiProperty({ enum: [...STATEMENT_SUGGESTED_ACTIONS] })
  action!: StatementSuggestedAction;

  @ApiProperty({ description: 'Confidence of the proposal; 0 when it needs input.' })
  score!: number;

  @ApiPropertyOptional({
    type: TransactionSummaryDto,
    nullable: true,
    description: 'The transaction to link — set when `action = match`.',
  })
  transaction?: TransactionSummaryDto | null;

  @ApiPropertyOptional({ nullable: true, description: 'Remembered category for `create`.' })
  categoryId?: string | null;

  @ApiPropertyOptional({ type: TransactionCategorySummary, nullable: true })
  category?: TransactionCategorySummary | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The own account on the other side — set when `action = transfer`.',
  })
  transferAccountId?: string | null;

  @ApiProperty({
    type: [StatementCandidateDto],
    description: 'Up to five alternatives, best first.',
  })
  candidates!: StatementCandidateDto[];
}
