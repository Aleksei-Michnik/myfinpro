import { type StatementLineStatus } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionSummaryDto } from '../../transaction/dto/transaction-summary.dto';
import { StatementSuggestionDto } from './statement-suggestion.dto';

/**
 * One statement line — the bank truth (design §2.5), as the review queue
 * renders it. Immutable except for its lifecycle: `status`, `transactionId`,
 * `decidedAt` / `decidedById`, and the matcher's `suggestion` snapshot.
 *
 * `description` is untrusted text: it is stored sanitized (control and bidi
 * marks stripped) and must be rendered as text, never as markup (§9).
 */
export class StatementLineResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty() importId!: string;

  @ApiProperty({ description: "The bank's posting date (ISO)." }) postedAt!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Purchase date, when it differs.' })
  valueAt?: string | null;

  @ApiProperty({ enum: ['IN', 'OUT'] }) direction!: 'IN' | 'OUT';
  @ApiProperty() amountCents!: number;
  @ApiProperty() currency!: string;

  @ApiProperty() description!: string;
  @ApiProperty({ description: 'The lookup form the category memory and matcher use.' })
  normalizedDescription!: string;
  @ApiPropertyOptional({ nullable: true }) memo?: string | null;
  @ApiPropertyOptional({ nullable: true }) externalId?: string | null;
  @ApiPropertyOptional({ nullable: true }) balanceAfterCents?: number | null;
  @ApiPropertyOptional({ nullable: true }) originalAmountCents?: number | null;
  @ApiPropertyOptional({ nullable: true }) originalCurrency?: string | null;
  @ApiPropertyOptional({ nullable: true }) installmentNumber?: number | null;
  @ApiPropertyOptional({ nullable: true }) installmentTotal?: number | null;
  @ApiPropertyOptional({ nullable: true }) categoryHint?: string | null;

  @ApiProperty({ enum: ['PENDING', 'MATCHED', 'CREATED', 'IGNORED'] })
  status!: StatementLineStatus;

  @ApiPropertyOptional({ nullable: true }) transactionId?: string | null;
  @ApiPropertyOptional({
    type: TransactionSummaryDto,
    nullable: true,
    description: 'The linked transaction, resolved on list and decision responses.',
  })
  transaction?: TransactionSummaryDto | null;

  @ApiPropertyOptional({
    type: StatementSuggestionDto,
    nullable: true,
    description:
      'What the matcher proposed at import time; null when it had nothing to say. Kept ' +
      'after a decision as the record of what was offered — the review filters only ever ' +
      'look at pending lines.',
  })
  suggestion?: StatementSuggestionDto | null;

  @ApiPropertyOptional({ nullable: true }) decidedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) decidedById?: string | null;
  @ApiProperty() createdAt!: string;
}

/** Cursor-paginated envelope for the review queue. */
export class StatementLineListResponseDto {
  @ApiProperty({ type: [StatementLineResponseDto] }) data!: StatementLineResponseDto[];
  @ApiPropertyOptional({ nullable: true }) nextCursor?: string | null;
  @ApiProperty() hasMore!: boolean;
}

/** A decision's response: the line, plus the transaction it produced. */
export class StatementLineDecisionResponseDto {
  @ApiProperty({ type: StatementLineResponseDto }) line!: StatementLineResponseDto;
  @ApiPropertyOptional({
    type: TransactionSummaryDto,
    nullable: true,
    description: 'The created or enriched transaction; null for ignore / unlink.',
  })
  transaction?: TransactionSummaryDto | null;
}
