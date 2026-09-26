// Phase 20 · Iteration 20.4 — the statement parsing engine (design §4.1).
//
// ONE walk over `string[][]`, driven entirely by preset data: find a header
// row, map its columns onto canonical fields, read the rows below it until
// the table ends, and start over when another header row appears (Isracard
// prints several tables on one sheet). Rows outside a table are title rows
// and feed the preset's extractors (billing cycle, card last4).
//
// Pure and total: an unreadable row becomes a warning carrying its index,
// never an exception and never the row's content (design §9).

import type { ImportLineInput } from '../types/account.types';
import { normalizeHeader, sanitizeStatementText } from './normalize';
import { FALLBACK_PRESET_ID, STATEMENT_PRESETS, STATEMENT_PRESETS_BY_ID } from './presets';
import type {
  ManualColumnMapping,
  ParseStatementOptions,
  ParsedStatement,
  StatementAmountConvention,
  StatementField,
  StatementPreset,
  StatementPresetId,
  StatementTitleInfo,
  StatementWarning,
} from './types';
import {
  parseAmountCents,
  parseCurrencyCode,
  parseInstallments,
  parseStatementDate,
} from './values';

/** Longest reference / category-hint values the line columns hold. */
const EXTERNAL_ID_MAX_LENGTH = 64;
const CATEGORY_HINT_MAX_LENGTH = 100;

/** A header row must map at least this many canonical fields to count. */
const MIN_HEADER_FIELDS = 2;

type ColumnMap = Partial<Record<StatementField, number>>;

interface HeaderMatch {
  rowIndex: number;
  columns: ColumnMap;
  /** How many canonical fields this row mapped — the specificity score. */
  fieldCount: number;
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => sanitizeStatementText(cell ?? '', 50) === '');
}

function nonEmptyCells(cells: string[]): string[] {
  return cells.map((cell) => sanitizeStatementText(cell ?? '')).filter((cell) => cell !== '');
}

/**
 * Map one row's cells onto canonical fields with a preset's alias lists.
 * Exact header matches win; only fields still unmapped fall back to a
 * substring match (Hapoalim prints `יתרה בש"ח` where the alias is `יתרה`).
 */
function mapHeaderRow(preset: StatementPreset, cells: string[]): ColumnMap {
  const headers = cells.map((cell) => normalizeHeader(cell ?? ''));
  const columns: ColumnMap = {};

  for (const [field, aliases] of Object.entries(preset.headerAliases) as [
    StatementField,
    string[],
  ][]) {
    const normalized = aliases.map(normalizeHeader);
    let index = headers.findIndex((header) => header !== '' && normalized.includes(header));
    if (index === -1) {
      index = headers.findIndex(
        (header) => header !== '' && normalized.some((alias) => header.includes(alias)),
      );
    }
    if (index !== -1) columns[field] = index;
  }
  return columns;
}

function countFields(columns: ColumnMap): number {
  return Object.keys(columns).length;
}

/** Does the row carry a date column and at least one money column? */
function isUsableHeader(columns: ColumnMap): boolean {
  const hasDate = columns.date !== undefined || columns.valueDate !== undefined;
  const hasMoney =
    columns.debit !== undefined ||
    columns.credit !== undefined ||
    columns.signedAmount !== undefined ||
    columns.amount !== undefined;
  return hasDate && hasMoney && countFields(columns) >= MIN_HEADER_FIELDS;
}

/** Every header group of `detect` must be present in this row. */
function matchesDetectMarkers(preset: StatementPreset, cells: string[]): boolean {
  const headers = cells.map((cell) => normalizeHeader(cell ?? '')).filter((h) => h !== '');
  return preset.detect.headers.every((group) =>
    group.some((alias) => {
      const needle = normalizeHeader(alias);
      return headers.some((header) => header === needle || header.includes(needle));
    }),
  );
}

function titleBonus(preset: StatementPreset, rows: string[][]): number {
  if (!preset.detect.titles?.length) return 0;
  const text = rows
    .slice(0, 30)
    .map((row) => normalizeHeader(nonEmptyCells(row).join(' ')))
    .join(' | ');
  return preset.detect.titles.some((marker) => text.includes(normalizeHeader(marker))) ? 1 : 0;
}

interface PresetDetection {
  preset: StatementPreset;
  header: HeaderMatch;
  score: number;
}

function detectPresetInternal(rows: string[][]): PresetDetection | null {
  let best: PresetDetection | null = null;

  for (const preset of STATEMENT_PRESETS) {
    let bestHeader: HeaderMatch | null = null;
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i] ?? [];
      if (!matchesDetectMarkers(preset, cells)) continue;
      const columns = mapHeaderRow(preset, cells);
      if (!isUsableHeader(columns)) continue;
      const fieldCount = countFields(columns);
      if (!bestHeader || fieldCount > bestHeader.fieldCount) {
        bestHeader = { rowIndex: i, columns, fieldCount };
      }
    }
    if (!bestHeader) continue;

    // Specific presets beat the generic fallback on an equal header row.
    const specificity = preset.id === FALLBACK_PRESET_ID ? 0 : 10;
    const score = specificity + bestHeader.fieldCount + titleBonus(preset, rows);
    if (!best || score > best.score) best = { preset, header: bestHeader, score };
  }
  return best;
}

/**
 * Which preset these rows look like — `null` when no preset's markers are
 * present (the wizard then offers the manual column picker).
 */
export function detectPreset(rows: string[][]): StatementPresetId | null {
  return detectPresetInternal(rows)?.preset.id ?? null;
}

function resolveConvention(
  convention: StatementAmountConvention,
  columns: ColumnMap,
): Exclude<StatementAmountConvention, 'auto'> {
  if (convention !== 'auto') return convention;
  return columns.debit !== undefined && columns.credit !== undefined ? 'debit-credit' : 'signed';
}

function cellAt(cells: string[], index: number | undefined): string {
  return index === undefined ? '' : (cells[index] ?? '');
}

interface AmountRead {
  amountCents: number;
  direction: 'IN' | 'OUT';
}

function readAmount(
  cells: string[],
  columns: ColumnMap,
  convention: Exclude<StatementAmountConvention, 'auto'>,
): AmountRead | null {
  if (convention === 'debit-credit') {
    const debit = parseAmountCents(cellAt(cells, columns.debit));
    if (debit !== null && debit !== 0) {
      // A debit column printing a negative value still means money left.
      return { amountCents: Math.abs(debit), direction: 'OUT' };
    }
    const credit = parseAmountCents(cellAt(cells, columns.credit));
    if (credit !== null && credit !== 0) {
      return { amountCents: Math.abs(credit), direction: 'IN' };
    }
    return null;
  }

  const raw =
    convention === 'charge-original'
      ? (parseAmountCents(cellAt(cells, columns.amount)) ??
        parseAmountCents(cellAt(cells, columns.signedAmount)))
      : (parseAmountCents(cellAt(cells, columns.signedAmount)) ??
        parseAmountCents(cellAt(cells, columns.amount)));
  if (raw === null || raw === 0) return null;

  if (convention === 'charge-original') {
    // A card charge takes money out; a negative charge is a refund.
    return { amountCents: Math.abs(raw), direction: raw > 0 ? 'OUT' : 'IN' };
  }
  return { amountCents: Math.abs(raw), direction: raw > 0 ? 'IN' : 'OUT' };
}

function isSkippableRow(preset: StatementPreset, cells: string[], description: string): boolean {
  const populated = nonEmptyCells(cells);
  // A totals row prints `סה"כ` in its description column on card statements
  // and in the leading (date) column on bank statements — test both.
  const candidates = [description, populated[0] ?? ''].map(normalizeHeader);
  if (
    preset.skipDescriptionPrefixes?.some((prefix) => {
      const needle = normalizeHeader(prefix);
      return candidates.some((value) => value !== '' && value.startsWith(needle));
    })
  ) {
    return true;
  }
  if (preset.skipRowMarkers?.length) {
    const text = normalizeHeader(nonEmptyCells(cells).join(' '));
    if (preset.skipRowMarkers.some((marker) => text.includes(normalizeHeader(marker)))) return true;
  }
  // A single populated cell is a section heading, never a money row.
  return populated.length === 1;
}

interface ParsedRow {
  line?: ImportLineInput;
  warning?: Omit<StatementWarning, 'row'>;
  /** Silent skip — a totals row, a section heading, a repeated header. */
  skipped?: boolean;
}

function parseDataRow(
  preset: StatementPreset,
  columns: ColumnMap,
  convention: Exclude<StatementAmountConvention, 'auto'>,
  cells: string[],
  currency: string,
): ParsedRow {
  const memo = sanitizeStatementText(cellAt(cells, columns.memo));
  let description = sanitizeStatementText(cellAt(cells, columns.description));
  if (isSkippableRow(preset, cells, description || memo)) return { skipped: true };

  const postedAtIso = parseStatementDate(cellAt(cells, columns.date));
  const valueAtIso = parseStatementDate(cellAt(cells, columns.valueDate));
  const posted = postedAtIso ?? valueAtIso;
  const amount = readAmount(cells, columns, convention);

  if (!posted) {
    return {
      warning: {
        code: amount ? 'invalid_date' : 'row_unparsed',
        description: description || undefined,
      },
    };
  }
  if (!amount) {
    return { warning: { code: 'invalid_amount', description: description || undefined } };
  }
  if (!description) {
    description = memo;
    if (!description) return { warning: { code: 'missing_description' } };
  }

  const line: ImportLineInput = {
    postedAt: posted,
    amountCents: amount.amountCents,
    direction: amount.direction,
    currency: parseCurrencyCode(cellAt(cells, columns.chargeCurrency)) ?? currency,
    description,
  };

  if (valueAtIso && valueAtIso !== posted) line.valueAt = valueAtIso;
  if (memo && memo !== description) line.memo = memo;

  const reference = sanitizeStatementText(cellAt(cells, columns.reference), EXTERNAL_ID_MAX_LENGTH);
  if (reference) line.externalId = reference;

  const balance = parseAmountCents(cellAt(cells, columns.balance));
  if (balance !== null) line.balanceAfterCents = balance;

  // The purchase-currency pair is display data (design §11) — kept only when
  // it actually differs from the amount that moved money.
  const original = parseAmountCents(cellAt(cells, columns.originalAmount));
  const originalCurrency = parseCurrencyCode(cellAt(cells, columns.originalCurrency));
  if (original !== null && original !== 0) {
    const differs =
      Math.abs(original) !== line.amountCents ||
      (originalCurrency !== null && originalCurrency !== line.currency);
    if (differs) {
      line.originalAmountCents = Math.abs(original);
      if (originalCurrency) line.originalCurrency = originalCurrency;
    }
  }

  const installments =
    parseInstallments(cellAt(cells, columns.installments)) ||
    parseInstallments(memo) ||
    parseInstallments(description);
  if (installments) {
    line.installmentNumber = installments.number;
    line.installmentTotal = installments.total;
  }

  const categoryHint = sanitizeStatementText(
    cellAt(cells, columns.categoryHint),
    CATEGORY_HINT_MAX_LENGTH,
  );
  if (categoryHint) line.categoryHint = categoryHint;

  return { line };
}

function mergeTitleInfo(target: StatementTitleInfo, info: StatementTitleInfo): void {
  for (const [key, value] of Object.entries(info) as [keyof StatementTitleInfo, never][]) {
    if (value !== undefined && target[key] === undefined) target[key] = value;
  }
}

function manualColumns(mapping: ManualColumnMapping): ColumnMap {
  const columns: ColumnMap = {};
  for (const [field, index] of Object.entries(mapping.columns) as [StatementField, number][]) {
    if (Number.isInteger(index) && index >= 0) columns[field] = index;
  }
  return columns;
}

/**
 * Parse decoded spreadsheet / CSV rows into normalised import lines.
 *
 * `options.mapping` (the wizard's manual column picker) wins over
 * `options.preset`, which wins over auto-detection. The result's `preset`
 * says which of the three produced the lines.
 */
export function parseStatementRows(
  rows: string[][],
  options: ParseStatementOptions = {},
): ParsedStatement {
  const warnings: StatementWarning[] = [];
  const lines: ImportLineInput[] = [];
  const titleInfo: StatementTitleInfo = {};
  const titleSegments: string[] = [];

  let preset: StatementPreset;
  let presetLabel: StatementPresetId | 'manual' | null;
  let fixedColumns: ColumnMap | null = null;
  let fixedConvention: StatementAmountConvention | null = null;
  let firstDataRow = 0;

  if (options.mapping) {
    preset = STATEMENT_PRESETS_BY_ID[FALLBACK_PRESET_ID];
    presetLabel = 'manual';
    fixedColumns = manualColumns(options.mapping);
    fixedConvention = options.mapping.convention ?? 'auto';
    firstDataRow = (options.mapping.headerRowIndex ?? -1) + 1;
    if (!isUsableHeader(fixedColumns)) {
      return { preset: 'manual', lines, warnings: [{ row: 0, code: 'no_header' }] };
    }
  } else if (options.preset) {
    preset = STATEMENT_PRESETS_BY_ID[options.preset];
    presetLabel = options.preset;
  } else {
    const detected = detectPresetInternal(rows);
    if (!detected) {
      return { preset: null, lines, warnings: [{ row: 0, code: 'no_header' }] };
    }
    preset = detected.preset;
    presetLabel = detected.preset.id;
  }

  const currency = options.currency ?? preset.defaultCurrency ?? 'ILS';

  let columns: ColumnMap | null = fixedColumns;
  let convention: Exclude<StatementAmountConvention, 'auto'> | null = fixedColumns
    ? resolveConvention(fixedConvention ?? preset.convention, fixedColumns)
    : null;
  let sawHeader = fixedColumns !== null;

  for (let i = 0; i < rows.length; i++) {
    if (fixedColumns && i < firstDataRow) {
      titleSegments.push(...nonEmptyCells(rows[i] ?? []));
      continue;
    }
    const cells = rows[i] ?? [];

    if (isBlankRow(cells)) {
      // A blank row ends the current table; the next one re-detects.
      if (!fixedColumns) columns = null;
      continue;
    }

    if (!fixedColumns) {
      const candidate = mapHeaderRow(preset, cells);
      if (isUsableHeader(candidate)) {
        columns = candidate;
        convention = resolveConvention(preset.convention, candidate);
        sawHeader = true;
        continue;
      }
    }

    if (!columns || !convention) {
      titleSegments.push(...nonEmptyCells(cells));
      continue;
    }

    const parsed = parseDataRow(preset, columns, convention, cells, currency);
    if (parsed.line) lines.push(parsed.line);
    else if (parsed.warning) warnings.push({ row: i, ...parsed.warning });
  }

  if (!sawHeader) {
    return { preset: presetLabel, lines, warnings: [{ row: 0, code: 'no_header' }] };
  }

  const titleText = titleSegments.join(' | ');
  for (const extractor of preset.titleExtractors ?? []) {
    const info = extractor(titleText);
    if (info) mergeTitleInfo(titleInfo, info);
  }

  const result: ParsedStatement = { preset: presetLabel, lines, warnings };
  if (titleInfo.last4) result.last4 = titleInfo.last4;

  // Period: the title rows when a card statement printed one, else the span
  // the lines themselves cover.
  const dates = lines.map((line) => line.postedAt).sort();
  result.periodFrom = titleInfo.periodFrom ?? dates[0];
  result.periodTo = titleInfo.periodTo ?? dates[dates.length - 1];

  // Statement balance: the running-balance column of the latest line that
  // has one (bank statements), unless a title row stated it outright.
  if (titleInfo.statementBalanceCents !== undefined) {
    result.statementBalanceCents = titleInfo.statementBalanceCents;
    result.statementBalanceAt = titleInfo.statementBalanceAt ?? result.periodTo;
  } else {
    const withBalance = lines.filter((line) => line.balanceAfterCents !== undefined);
    const latest = withBalance.reduce<ImportLineInput | null>(
      (best, line) => (!best || line.postedAt >= best.postedAt ? line : best),
      null,
    );
    if (latest) {
      result.statementBalanceCents = latest.balanceAfterCents;
      result.statementBalanceAt = latest.postedAt;
    }
  }

  return result;
}
