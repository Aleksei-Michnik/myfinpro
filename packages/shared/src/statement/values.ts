// Phase 20 · Iteration 20.4 — cell value readers for the statement engine.
//
// Every cell arrives as a string: the browser decoder stringifies whatever
// the spreadsheet held, so an Excel date can turn up as a serial number
// ("46270"), a Hebrew bank amount can carry `₪`, thousands separators, a
// trailing minus or parentheses, and RTL marks can sit anywhere. These
// readers are pure and total — they return `null` rather than throwing, and
// the engine turns a `null` into a warning carrying the row index only.

import { sanitizeStatementText } from './normalize';

/**
 * Excel's day 0 is 1899-12-30 (the 1900 leap-year bug is baked into the
 * serial), so serial → UTC ms is `(serial - 0) * 86400000` from that date.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/**
 * Range in which a bare number is read as an Excel date serial rather than a
 * year or an amount: 30000 ≈ 1982-02-18, 60000 ≈ 2064-04-08 (design §4.1).
 */
export const EXCEL_SERIAL_MIN = 30_000;
export const EXCEL_SERIAL_MAX = 60_000;

/** Two-digit years at or below this belong to the 2000s, above to the 1900s. */
const TWO_DIGIT_YEAR_PIVOT = 69;

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Read a date cell into `yyyy-mm-dd`.
 *
 * Accepted: `dd/mm/yyyy`, `dd.mm.yyyy`, `dd-mm-yyyy`, `dd/mm/yy`,
 * `yyyy-mm-dd`, `yyyy/mm/dd` and Excel serials. Day-first is the Israeli
 * convention and the only ambiguous case (`03/04/2026` is 3 April).
 */
export function parseStatementDate(raw: string): string | null {
  const value = sanitizeStatementText(raw, 40).replace(/[−]/g, '-');
  if (!value) return null;

  // ISO first — `yyyy-mm-dd` / `yyyy/mm/dd`, optionally with a time part.
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(value);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(value);
  if (dmy) {
    let year = Number(dmy[3]);
    if (dmy[3].length === 2) year += year <= TWO_DIGIT_YEAR_PIVOT ? 2000 : 1900;
    return isoDate(year, Number(dmy[2]), Number(dmy[1]));
  }

  // Bare number → Excel serial (fractional part = time of day, dropped).
  if (/^\d+(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (serial > EXCEL_SERIAL_MIN && serial < EXCEL_SERIAL_MAX) {
      return new Date(EXCEL_EPOCH_MS + Math.floor(serial) * MS_PER_DAY).toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * Read a money cell into minor units, keeping its sign.
 *
 * Handles `₪`/`ש"ח`/`NIS`/`$`/`€` symbols, thousands separators (`,` and the
 * space some exports use), a leading or trailing minus (including the
 * Unicode minus), and parentheses for negatives. An empty or dash-only cell
 * is "no value" and returns `null` — the engine treats that as "this money
 * column is not the one carrying the amount", not as an error.
 */
export function parseAmountCents(raw: string): number | null {
  let value = sanitizeStatementText(raw, 40);
  if (!value) return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }

  value = value
    .replace(/[−]/g, '-')
    .replace(/[₪$€£]|ש"ח|שח|nis|ils|usd|eur/gi, '')
    .replace(/\s/g, '')
    .trim();

  if (value.endsWith('-')) {
    negative = true;
    value = value.slice(0, -1);
  }
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  }
  if (value.startsWith('+')) value = value.slice(1);

  // Thousands separators: commas are never decimal separators in these files.
  value = value.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(value)) return null;

  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Currency spellings seen in `מטבע חיוב` / `מטבע עסקה` columns. */
const CURRENCY_ALIASES: Record<string, string> = {
  '₪': 'ILS',
  'ש"ח': 'ILS',
  שח: 'ILS',
  שקל: 'ILS',
  'שקל חדש': 'ILS',
  nis: 'ILS',
  ils: 'ILS',
  $: 'USD',
  usd: 'USD',
  דולר: 'USD',
  'דולר ארה"ב': 'USD',
  '€': 'EUR',
  eur: 'EUR',
  אירו: 'EUR',
  '£': 'GBP',
  gbp: 'GBP',
};

/** Read a currency cell into an ISO-4217 code, or `null` when unreadable. */
export function parseCurrencyCode(raw: string): string | null {
  const value = sanitizeStatementText(raw, 30);
  if (!value) return null;
  const alias = CURRENCY_ALIASES[value.toLowerCase()] ?? CURRENCY_ALIASES[value];
  if (alias) return alias;
  return /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null;
}

export interface ParsedInstallments {
  number: number;
  total: number;
}

/**
 * Read an installment marker out of a free-text cell: `תשלום 2 מתוך 6`,
 * `2 מ-6`, `2/6`, `payment 2 of 6`. Returns `null` when the text carries
 * none, and ignores impossible pairs (`0/6`, `7/6`).
 */
export function parseInstallments(raw: string): ParsedInstallments | null {
  const value = sanitizeStatementText(raw, 120);
  if (!value) return null;

  const patterns = [
    /(\d{1,3})\s*(?:מתוך|מ\s*-\s*|מ־|of)\s*(\d{1,3})/i,
    /(\d{1,3})\s*\/\s*(\d{1,3})/,
  ];
  for (const pattern of patterns) {
    const hit = pattern.exec(value);
    if (!hit) continue;
    const number = Number(hit[1]);
    const total = Number(hit[2]);
    if (number >= 1 && total >= 1 && number <= total) return { number, total };
  }
  return null;
}

/** Hebrew month names as Israeli card statements print them in title rows. */
export const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
] as const;

/**
 * `ספטמבר 2026` → `{ year: 2026, month: 9 }`; `null` when absent. The year
 * is only read AFTER the month name, so a card number printed earlier in the
 * same title block can never be mistaken for one.
 */
export function parseHebrewMonthYear(raw: string): { year: number; month: number } | null {
  const value = sanitizeStatementText(raw, 200);
  for (let i = 0; i < HEBREW_MONTHS.length; i++) {
    const at = value.indexOf(HEBREW_MONTHS[i]);
    if (at === -1) continue;
    const year = /(\d{4})/.exec(value.slice(at + HEBREW_MONTHS[i].length));
    if (!year) return null;
    return { year: Number(year[1]), month: i + 1 };
  }
  return null;
}
