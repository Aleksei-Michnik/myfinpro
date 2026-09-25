import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One import, with the counters the wizard's last step and the history tab
 * show (design §6.2). The row counters are frozen at import time; the
 * suggestion counters are computed per read, because a line's suggestion is
 * consumed as soon as it is decided.
 *
 * `totalCount = insertedCount + duplicateCount` and
 * `insertedCount = suggestedMatchCount + suggestedTransferCount +
 *  suggestedCreateCount + needsInputCount` at import time — `suggestedCreate`
 * counts only the create proposals that arrived WITH a remembered category,
 * the rest being `needsInput` (the review filter's `needs_input`).
 */
export class AccountImportResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty() importedById!: string;
  @ApiProperty({ example: 'hapoalim' }) source!: string;
  @ApiPropertyOptional({ nullable: true }) originalName?: string | null;
  @ApiPropertyOptional({ nullable: true }) periodFrom?: string | null;
  @ApiPropertyOptional({ nullable: true }) periodTo?: string | null;
  @ApiPropertyOptional({ nullable: true }) statementBalanceCents?: number | null;
  @ApiPropertyOptional({ nullable: true }) statementBalanceAt?: string | null;

  @ApiProperty({ description: 'Lines in the request.' }) totalCount!: number;
  @ApiProperty({ description: 'Lines stored (new fingerprints).' }) insertedCount!: number;
  @ApiProperty({ description: 'Lines already known on this account.' }) duplicateCount!: number;

  @ApiProperty({
    description: 'Still-pending lines suggesting a match to an existing transaction.',
  })
  suggestedMatchCount!: number;
  @ApiProperty({ description: 'Still-pending lines suggesting a transfer between own accounts.' })
  suggestedTransferCount!: number;
  @ApiProperty({ description: 'Still-pending lines suggesting a new transaction WITH a category.' })
  suggestedCreateCount!: number;
  @ApiProperty({ description: 'Still-pending lines the reviewer has to decide (design §6.2).' })
  needsInputCount!: number;

  @ApiProperty() createdAt!: string;
}

/** Cursor-paginated envelope, identical in shape to every other list here. */
export class AccountImportListResponseDto {
  @ApiProperty({ type: [AccountImportResponseDto] }) data!: AccountImportResponseDto[];
  @ApiPropertyOptional({ nullable: true }) nextCursor?: string | null;
  @ApiProperty() hasMore!: boolean;
}
