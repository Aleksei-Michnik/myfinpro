// Phase 20 · Iteration 20.4 — the statement parser's vocabulary.
//
// One engine (`parse.ts`) walks `string[][]` with a preset (`presets.ts`); a
// preset is DATA — header aliases, an amount convention, skip rules and a
// couple of tiny title extractors. There is no per-institution code path, so
// a format drifting only costs a data edit (design §4.1).
//
// Everything here is pure TypeScript: the same code runs in the browser
// (the 20.5 import wizard decodes the spreadsheet, then parses) and in the
// user-run connector (20.7). No Node, DOM or Prisma types may leak in.

import type { AccountImportSource, ImportLineInput } from '../types/account.types';

/**
 * Presets that ship today — a subset of `ACCOUNT_IMPORT_SOURCES`, so a
 * detected preset id is directly the `source` of the import it produces.
 * (`amex` and `mizrahi` are import sources without a preset yet: their
 * exports fall back to `generic_csv` or the manual column picker.)
 */
export const STATEMENT_PRESET_IDS = [
  'hapoalim',
  'leumi',
  'discount',
  'isracard',
  'cal',
  'max',
  'generic_csv',
] as const satisfies readonly AccountImportSource[];
export type StatementPresetId = (typeof STATEMENT_PRESET_IDS)[number];

/**
 * Canonical columns the engine understands. A preset maps its (Hebrew or
 * English) header names onto these; a manual mapping picks them by index.
 */
export const STATEMENT_FIELDS = [
  'date',
  'valueDate',
  'description',
  'memo',
  'reference',
  'debit',
  'credit',
  'signedAmount',
  'amount',
  'originalAmount',
  'originalCurrency',
  'chargeCurrency',
  'balance',
  'categoryHint',
  'installments',
] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];

/**
 * How a row's money columns say what moved, and in which direction.
 *
 * - `debit-credit`   — two columns; a value in the debit column is OUT, in
 *   the credit column IN (Israeli bank statements).
 * - `signed`         — one column whose sign carries the direction: negative
 *   is OUT, positive IN (Discount's `זכות/חובה`, most generic CSVs).
 * - `charge-original`— card statements: the charged amount moves money and a
 *   charge is OUT; a negative charge is a refund/credit and therefore IN.
 *   The purchase-currency pair is kept for display only.
 * - `auto`           — resolved per header row: debit+credit when both
 *   columns are present, otherwise `signed` (the `generic_csv` fallback).
 */
export type StatementAmountConvention = 'debit-credit' | 'signed' | 'charge-original' | 'auto';

/** Facts a preset can lift out of the rows above a table's header. */
export interface StatementTitleInfo {
  /** Masked card identifier printed in a card statement's title ("… - 0423"). */
  last4?: string;
  /** First day covered by the statement (ISO yyyy-mm-dd). */
  periodFrom?: string;
  /**
   * Last day covered by the statement (ISO yyyy-mm-dd). On a card statement
   * this is the billing date — the day the bank is debited for the cycle
   * (Isracard prints `לחיוב ב-10.09`).
   */
  periodTo?: string;
  /** Closing balance printed in a title/summary row, in minor units. */
  statementBalanceCents?: number;
  /** ISO yyyy-mm-dd the closing balance is stated as of. */
  statementBalanceAt?: string;
}

/**
 * Extracts `StatementTitleInfo` from the rows that sit outside any table —
 * their non-empty cells sanitized and joined with ` | `, so one extractor
 * can combine facts printed on separate title rows (Isracard prints the
 * billing month on one and the billing day on another). Pure.
 */
export type StatementTitleExtractor = (titleText: string) => StatementTitleInfo | null;

export interface StatementPresetDetect {
  /**
   * Header groups that must ALL be present in one row for the preset to fit;
   * each group is a list of acceptable spellings (any one matches).
   */
  headers: string[][];
  /** Strings seen in title rows that reinforce the match (never required). */
  titles?: string[];
}

export interface StatementPreset {
  id: StatementPresetId;
  detect: StatementPresetDetect;
  /** Canonical field ← the header spellings that mean it. */
  headerAliases: Partial<Record<StatementField, string[]>>;
  convention: StatementAmountConvention;
  /**
   * Rows whose description starts with one of these are totals / section
   * titles and are dropped silently (never a warning): `סה"כ`, section
   * headings such as Isracard's `עסקאות שטרם נקלטו`.
   */
  skipDescriptionPrefixes?: string[];
  /** Cells that mark a row as a section heading wherever they appear in it. */
  skipRowMarkers?: string[];
  /** Run over every title row (rows outside any table). */
  titleExtractors?: StatementTitleExtractor[];
  /**
   * Currency of the moved amount when the file has no currency column.
   * Overridden by `chargeCurrency` per row and by the caller's `currency`.
   */
  defaultCurrency?: string;
}

/** Why a row produced no line, by index — never the row's content. */
export const STATEMENT_WARNING_CODES = [
  /** No header row matched any preset (or the mapping): nothing was parsed. */
  'no_header',
  /** The row has content but neither a usable date nor a usable amount. */
  'row_unparsed',
  /** A date cell could not be read in any supported format. */
  'invalid_date',
  /** An amount cell could not be read, or every money column was empty. */
  'invalid_amount',
  /** The row has money and a date but no description text. */
  'missing_description',
] as const;
export type StatementWarningCode = (typeof STATEMENT_WARNING_CODES)[number];

export interface StatementWarning {
  /** 0-based index into the `rows` array that was handed to the parser. */
  row: number;
  code: StatementWarningCode;
  /**
   * The row's description, when one was readable — the only cell content a
   * warning may carry (design §9: never echo a statement row).
   */
  description?: string;
}

/** Explicit column choice from the wizard's fallback picker. */
export interface ManualColumnMapping {
  /** 0-based column index per canonical field. */
  columns: Partial<Record<StatementField, number>>;
  /** 0-based index of the header row; rows after it are data. */
  headerRowIndex?: number;
  /** Defaults to `auto` (debit+credit when both are mapped, else signed). */
  convention?: StatementAmountConvention;
}

export interface ParseStatementOptions {
  /** Force a preset instead of detecting one. */
  preset?: StatementPresetId;
  /** Explicit columns; wins over `preset` and detection. */
  mapping?: ManualColumnMapping;
  /**
   * The account's currency — used for lines whose file carries no currency
   * column. Falls back to the preset's default (`ILS`).
   */
  currency?: string;
}

export interface ParsedStatement {
  /** The preset used, `'manual'` for an explicit mapping, `null` if nothing matched. */
  preset: StatementPresetId | 'manual' | null;
  lines: ImportLineInput[];
  statementBalanceCents?: number;
  statementBalanceAt?: string;
  periodFrom?: string;
  periodTo?: string;
  last4?: string;
  warnings: StatementWarning[];
}
