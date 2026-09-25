import { ACCOUNT_IMPORT_MAX_LINES, ACCOUNT_IMPORT_SOURCES } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_ACCOUNT_BALANCE_CENTS } from './create-account.dto';
import { ImportLineDto } from './import-line.dto';

/**
 * Hard body fence, derived from the documented cap so the two can never
 * disagree. Between the two numbers the request is answered with the
 * documented `ACCOUNT_IMPORT_TOO_LARGE`; above it the body is refused
 * outright, because validating an unbounded array is the DoS.
 */
export const ACCOUNT_IMPORT_HARD_LINE_CAP = ACCOUNT_IMPORT_MAX_LINES * 5;

/**
 * POST /accounts/:id/imports body — Phase 20, iteration 20.4 (design §6.2).
 *
 * The API never receives the statement FILE: the browser decodes and parses
 * it (`packages/shared/src/statement`), and a statement longer than
 * `ACCOUNT_IMPORT_MAX_LINES` arrives as consecutive chunks, one import row
 * each, sharing an `originalName`.
 */
export class CreateImportDto {
  @ApiProperty({
    enum: [...ACCOUNT_IMPORT_SOURCES],
    description: 'Which preset (or channel) produced these lines.',
    example: 'hapoalim',
  })
  @IsIn([...ACCOUNT_IMPORT_SOURCES])
  source!: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'File name shown in the import history. The file itself is never uploaded.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  originalName?: string;

  @ApiProperty({
    type: [ImportLineDto],
    maxItems: ACCOUNT_IMPORT_MAX_LINES,
    description: 'The parsed rows, in file order — the ordinal tie-breaker of the fingerprint.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ACCOUNT_IMPORT_HARD_LINE_CAP)
  @ValidateNested({ each: true })
  @Type(() => ImportLineDto)
  lines!: ImportLineDto[];

  @ApiPropertyOptional({ description: "The statement's closing balance, in minor units." })
  @IsOptional()
  @IsInt()
  @Min(-MAX_ACCOUNT_BALANCE_CENTS)
  @Max(MAX_ACCOUNT_BALANCE_CENTS)
  statementBalanceCents?: number;

  @ApiPropertyOptional({
    description:
      "ISO date the closing balance is as of. When newer than the account's, it becomes " +
      'the reported balance the reconciliation gap is measured against (design §2.3).',
  })
  @IsOptional()
  @IsISO8601()
  statementBalanceAt?: string;

  @ApiPropertyOptional({ description: 'ISO date of the first day the statement covers.' })
  @IsOptional()
  @IsISO8601()
  periodFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date of the last day the statement covers.' })
  @IsOptional()
  @IsISO8601()
  periodTo?: string;
}
