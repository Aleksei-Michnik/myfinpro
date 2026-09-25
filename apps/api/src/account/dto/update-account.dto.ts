import {
  ACCOUNT_INSTITUTIONS,
  ACCOUNT_LAST4_PATTERN,
  CURRENCY_CODES,
  type AccountInstitution,
} from '@myfinpro/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { MAX_ACCOUNT_BALANCE_CENTS, MAX_BILLING_DAY } from './create-account.dto';

/**
 * PATCH /accounts/:id body — Phase 20, iteration 20.2 (design §6.1).
 *
 * Every field is optional; omitted fields keep their value. Nullable fields
 * accept an explicit `null` to clear (`@IsOptional()` skips validation for
 * null, so null passes through).
 *
 * `scopeType`, `groupId` and `currency` are **immutable** — recreate the
 * account to move it. They are accepted here only so a client echoing the
 * whole object back gets the documented `ACCOUNT_INVALID_SCOPE` when it tries
 * to change one, instead of an anonymous whitelist rejection; sending the
 * current value is a no-op.
 */
export class UpdateAccountDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({
    enum: [...ACCOUNT_INSTITUTIONS],
    nullable: true,
    description: 'Must issue accounts of this account kind. Null clears it.',
  })
  @IsOptional()
  @IsIn([...ACCOUNT_INSTITUTIONS])
  institution?: AccountInstitution | null;

  @ApiPropertyOptional({ nullable: true, description: '2 to 4 digits; null clears it.' })
  @IsOptional()
  @Matches(ACCOUNT_LAST4_PATTERN)
  last4?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 16 })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  color?: string | null;

  @ApiPropertyOptional({ description: 'Balance anchor amount in minor units; may be negative.' })
  @IsOptional()
  @IsInt()
  @Min(-MAX_ACCOUNT_BALANCE_CENTS)
  @Max(MAX_ACCOUNT_BALANCE_CENTS)
  openingBalanceCents?: number;

  @ApiPropertyOptional({ description: 'ISO 8601 date of the balance anchor.' })
  @IsOptional()
  @IsISO8601()
  openingBalanceAt?: string;

  @ApiPropertyOptional({ nullable: true, description: "The bank's own figure; null clears it." })
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
    description: 'CARD only; null clears it (and billingDay).',
  })
  @IsOptional()
  @IsUUID()
  billingAccountId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: MAX_BILLING_DAY })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BILLING_DAY)
  billingDay?: number | null;

  @ApiPropertyOptional({
    enum: ['personal', 'group'],
    description: 'Immutable — sending a different value yields ACCOUNT_INVALID_SCOPE.',
  })
  @IsOptional()
  @IsIn(['personal', 'group'])
  scopeType?: 'personal' | 'group';

  @ApiPropertyOptional({ description: 'Immutable — see scopeType.' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ description: 'Immutable — see scopeType.' })
  @IsOptional()
  @IsIn([...CURRENCY_CODES])
  currency?: string;
}
