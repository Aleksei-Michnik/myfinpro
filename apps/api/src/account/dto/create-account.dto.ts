import {
  ACCOUNT_INSTITUTIONS,
  ACCOUNT_KINDS,
  ACCOUNT_LAST4_PATTERN,
  CURRENCY_CODES,
  MAX_MINOR_UNITS,
  type AccountInstitution,
  type AccountKind,
} from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Ceiling of the balance INT columns — the one shared money limit. */
export const MAX_ACCOUNT_BALANCE_CENTS = MAX_MINOR_UNITS;

/** Billing day of a card, 1..28 so every month has one (design §2.4). */
export const MAX_BILLING_DAY = 28;

/**
 * POST /accounts body — Phase 20, iteration 20.2 (design §6.1).
 *
 * Shape and range validation only; everything that needs DB context (group
 * role, billing account visibility / kind / currency, institution ↔ kind
 * consistency, currency default) lives in AccountService.
 */
export class CreateAccountDto {
  @ApiProperty({ example: 'Everyday checking', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({ enum: [...ACCOUNT_KINDS], example: 'BANK' })
  @IsIn([...ACCOUNT_KINDS])
  kind!: AccountKind;

  @ApiPropertyOptional({
    enum: [...ACCOUNT_INSTITUTIONS],
    nullable: true,
    description: 'Closed list; must issue accounts of this `kind`. Null for cash / unknown.',
  })
  @IsOptional()
  @IsIn([...ACCOUNT_INSTITUTIONS])
  institution?: AccountInstitution | null;

  @ApiPropertyOptional({
    description:
      "ISO 4217 code from the supported list. Defaults to the owner's (personal) or " +
      "group's (group) defaultCurrency when omitted. Immutable afterwards.",
    example: 'ILS',
  })
  @IsOptional()
  @IsIn([...CURRENCY_CODES])
  currency?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Masked identifier — 2 to 4 digits. Never a full account or card number.',
    example: '4321',
  })
  @IsOptional()
  @Matches(ACCOUNT_LAST4_PATTERN)
  last4?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 16, example: '#1f6feb' })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  color?: string | null;

  @ApiProperty({ enum: ['personal', 'group'], example: 'personal' })
  @IsIn(['personal', 'group'])
  scopeType!: 'personal' | 'group';

  @ApiPropertyOptional({ description: 'Required when scopeType=group; forbidden otherwise.' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Balance anchor amount in minor units. May be negative — a card that owes money does.',
  })
  @IsOptional()
  @IsInt()
  @Min(-MAX_ACCOUNT_BALANCE_CENTS)
  @Max(MAX_ACCOUNT_BALANCE_CENTS)
  openingBalanceCents?: number;

  @ApiPropertyOptional({
    description:
      'ISO 8601 date of the anchor; defaults to now. Transactions before it never count.',
  })
  @IsOptional()
  @IsISO8601()
  openingBalanceAt?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: "The bank's own figure (design §2.3) — never derived.",
  })
  @IsOptional()
  @IsInt()
  @Min(-MAX_ACCOUNT_BALANCE_CENTS)
  @Max(MAX_ACCOUNT_BALANCE_CENTS)
  reportedBalanceCents?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'ISO 8601 date the bank figure is as of.' })
  @IsOptional()
  @IsISO8601()
  reportedBalanceAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'CARD only — the BANK account debited on the billing day (same scope + currency).',
  })
  @IsOptional()
  @IsUUID()
  billingAccountId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: MAX_BILLING_DAY,
    description: 'CARD only — requires billingAccountId.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BILLING_DAY)
  billingDay?: number | null;
}
