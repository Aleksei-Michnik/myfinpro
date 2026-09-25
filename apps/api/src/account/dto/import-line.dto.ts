import {
  IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH,
  IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH,
  IMPORT_LINE_MAX_INSTALLMENTS,
  STATEMENT_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_DIRECTIONS,
  type ImportLineInput,
} from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MAX_ACCOUNT_BALANCE_CENTS } from './create-account.dto';

/**
 * One normalised statement row on a POST /accounts/:id/imports body — the
 * wire form of the shared `ImportLineInput` (design §4.1), which the browser
 * parser and the 20.7 connector both produce.
 *
 * `currency` is the one field that may be omitted (it defaults to the
 * account's), which is why the class implements every OTHER field of
 * `ImportLineInput` rather than the whole interface.
 *
 * Shape and range only. Everything needing DB context (the account's
 * currency, the plausible date range, the fingerprint) is the service's, and
 * every rejection names the line's INDEX, never its content (design §9).
 */
export class ImportLineDto implements Omit<ImportLineInput, 'currency'> {
  @ApiProperty({ description: "The bank's posting date (ISO).", example: '2026-09-03' })
  @IsISO8601()
  postedAt!: string;

  @ApiPropertyOptional({
    description: 'Purchase date on card statements, when it differs from the posting date.',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601()
  valueAt?: string;

  @ApiProperty({ description: 'Positive minor units; the sign lives in `direction`.' })
  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNT_BALANCE_CENTS)
  amountCents!: number;

  @ApiProperty({ enum: [...TRANSACTION_DIRECTIONS] })
  @IsIn([...TRANSACTION_DIRECTIONS])
  direction!: 'IN' | 'OUT';

  @ApiPropertyOptional({
    description:
      "ISO 4217. Defaults to the account's currency; a line in any other currency is " +
      'rejected with ACCOUNT_CURRENCY_MISMATCH — only `originalCurrency` may differ.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiProperty({ maxLength: STATEMENT_DESCRIPTION_MAX_LENGTH })
  @IsString()
  @Length(1, STATEMENT_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiPropertyOptional({ maxLength: STATEMENT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @Length(1, STATEMENT_DESCRIPTION_MAX_LENGTH)
  memo?: string;

  @ApiPropertyOptional({
    maxLength: IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH,
    description: "The export's own reference number, when it has one.",
  })
  @IsOptional()
  @IsString()
  @Length(1, IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH)
  externalId?: string;

  @ApiPropertyOptional({ description: 'Running balance after the row, in minor units.' })
  @IsOptional()
  @IsInt()
  @Min(-MAX_ACCOUNT_BALANCE_CENTS)
  @Max(MAX_ACCOUNT_BALANCE_CENTS)
  balanceAfterCents?: number;

  @ApiPropertyOptional({ description: 'Card statements: the amount in the purchase currency.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNT_BALANCE_CENTS)
  originalAmountCents?: number;

  @ApiPropertyOptional({ description: 'May differ from the account currency (display only).' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  originalCurrency?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: IMPORT_LINE_MAX_INSTALLMENTS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(IMPORT_LINE_MAX_INSTALLMENTS)
  installmentNumber?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: IMPORT_LINE_MAX_INSTALLMENTS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(IMPORT_LINE_MAX_INSTALLMENTS)
  installmentTotal?: number;

  @ApiPropertyOptional({
    maxLength: IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH,
    description: "The issuer's own sector column, kept as a hint only.",
  })
  @IsOptional()
  @IsString()
  @Length(1, IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH)
  categoryHint?: string;
}
