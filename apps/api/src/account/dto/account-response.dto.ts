import { ACCOUNT_INSTITUTIONS, ACCOUNT_KINDS, type AccountKind } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Account representation returned by every /accounts endpoint (Phase 20.2).
 *
 * The stored columns plus the four derived figures of design §2.2/§2.3:
 * `ledgerBalanceCents` (never stored — always recomputed), the timestamp it
 * was computed at, the number of statement lines still awaiting a decision,
 * and the reconciliation gap against the bank's own number.
 */
export class AccountResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: [...ACCOUNT_KINDS] }) kind!: AccountKind;
  @ApiPropertyOptional({ enum: [...ACCOUNT_INSTITUTIONS], nullable: true })
  institution?: string | null;
  @ApiProperty({ description: 'ISO 4217 three-letter code. Immutable.' }) currency!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Masked identifier, 2–4 digits.' })
  last4?: string | null;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;

  @ApiProperty({ enum: ['personal', 'group'] }) scopeType!: 'personal' | 'group';
  @ApiPropertyOptional({ nullable: true }) ownerId?: string | null;
  @ApiPropertyOptional({ nullable: true }) groupId?: string | null;

  @ApiProperty({ description: 'Balance anchor amount in minor units.' })
  openingBalanceCents!: number;
  @ApiProperty({ description: 'ISO 8601 date of the balance anchor.' }) openingBalanceAt!: string;
  @ApiPropertyOptional({ nullable: true, description: "The bank's own figure." })
  reportedBalanceCents?: number | null;
  @ApiPropertyOptional({ nullable: true }) reportedBalanceAt?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'CARD only — the account that is debited.' })
  billingAccountId?: string | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 28 }) billingDay?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Set when the account is archived.' })
  archivedAt?: string | null;

  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  // ── derived, never stored (design §2.2 / §2.3) ──

  @ApiProperty({
    description:
      'openingBalanceCents + every countable transaction on this account since the anchor ' +
      '(POSTED one-time rows, signed by direction) + every incoming transfer.',
  })
  ledgerBalanceCents!: number;

  @ApiProperty({ description: 'ISO 8601 instant the ledger balance was computed at.' })
  ledgerBalanceAt!: string;

  @ApiProperty({ description: 'Statement lines still awaiting a decision (0 until 20.4).' })
  pendingLinesCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'reportedBalanceCents − the ledger balance as of reportedBalanceAt. ' +
      'Null when the account carries no bank figure. Information, never enforced.',
  })
  reconciliationGapCents?: number | null;
}
