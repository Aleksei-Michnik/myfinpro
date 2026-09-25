import { describe, expect, it } from 'vitest';
import {
  normalizeDescription,
  normalizeHeader,
  sanitizeStatementText,
} from '../statement/normalize';
import {
  parseAmountCents,
  parseCurrencyCode,
  parseHebrewMonthYear,
  parseInstallments,
  parseStatementDate,
} from '../statement/values';

describe('parseStatementDate', () => {
  it('reads the Israeli day-first formats', () => {
    expect(parseStatementDate('03/09/2026')).toBe('2026-09-03');
    expect(parseStatementDate('03.09.2026')).toBe('2026-09-03');
    expect(parseStatementDate('03-09-2026')).toBe('2026-09-03');
    expect(parseStatementDate('3/9/26')).toBe('2026-09-03');
  });

  it('reads ISO dates, with or without a time part', () => {
    expect(parseStatementDate('2026-09-03')).toBe('2026-09-03');
    expect(parseStatementDate('2026-09-03T14:05:00Z')).toBe('2026-09-03');
  });

  it('reads Excel serials inside the plausible window only', () => {
    // 46268 = 2026-09-03 in the 1900 serial system.
    expect(parseStatementDate('46268')).toBe('2026-09-03');
    expect(parseStatementDate('46268.5')).toBe('2026-09-03');
    expect(parseStatementDate('2026')).toBeNull();
    expect(parseStatementDate('61000')).toBeNull();
  });

  it('rejects impossible and unreadable dates', () => {
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('not a date')).toBeNull();
    expect(parseStatementDate('')).toBeNull();
  });

  it('ignores RTL marks around the digits', () => {
    expect(parseStatementDate('‏03/09/2026‎')).toBe('2026-09-03');
  });
});

describe('parseAmountCents', () => {
  it('reads shekel amounts with symbols and thousands separators', () => {
    expect(parseAmountCents('₪ 1,234.56')).toBe(123456);
    expect(parseAmountCents('1,234.56 ש"ח')).toBe(123456);
    expect(parseAmountCents('12 345.00 NIS')).toBe(1234500);
  });

  it('reads every negative spelling', () => {
    expect(parseAmountCents('-150.90')).toBe(-15090);
    expect(parseAmountCents('150.90-')).toBe(-15090);
    expect(parseAmountCents('(150.90)')).toBe(-15090);
    expect(parseAmountCents('−150.90')).toBe(-15090);
  });

  it('returns null for empty and unreadable cells', () => {
    expect(parseAmountCents('')).toBeNull();
    expect(parseAmountCents('   ')).toBeNull();
    expect(parseAmountCents('-')).toBeNull();
    expect(parseAmountCents('n/a')).toBeNull();
  });
});

describe('parseCurrencyCode', () => {
  it('maps the symbols and Hebrew names the exports print', () => {
    expect(parseCurrencyCode('₪')).toBe('ILS');
    expect(parseCurrencyCode('ש"ח')).toBe('ILS');
    expect(parseCurrencyCode('$')).toBe('USD');
    expect(parseCurrencyCode('usd')).toBe('USD');
    expect(parseCurrencyCode('דולר')).toBe('USD');
    expect(parseCurrencyCode('')).toBeNull();
    expect(parseCurrencyCode('gold')).toBeNull();
  });
});

describe('parseInstallments', () => {
  it('reads the Hebrew and numeric markers', () => {
    expect(parseInstallments('תשלום 2 מתוך 6')).toEqual({ number: 2, total: 6 });
    expect(parseInstallments('2 מ-6')).toEqual({ number: 2, total: 6 });
    expect(parseInstallments('2/6')).toEqual({ number: 2, total: 6 });
  });

  it('ignores impossible pairs and plain text', () => {
    expect(parseInstallments('7/6')).toBeNull();
    expect(parseInstallments('0/6')).toBeNull();
    expect(parseInstallments('רגילה')).toBeNull();
  });
});

describe('parseHebrewMonthYear', () => {
  it('reads a card statement month title', () => {
    expect(parseHebrewMonthYear('ספטמבר 2026')).toEqual({ year: 2026, month: 9 });
    expect(parseHebrewMonthYear('חיוב לחודש ינואר 2027')).toEqual({ year: 2027, month: 1 });
    expect(parseHebrewMonthYear('ספטמבר')).toBeNull();
  });
});

describe('normalisation', () => {
  it('strips control and bidi marks and collapses whitespace', () => {
    expect(sanitizeStatementText('‮סופר‏  פארם')).toBe('סופר פארם');
  });

  it('lowercases Latin text for the lookup form', () => {
    expect(normalizeDescription('  SUPER   Pharm ')).toBe('super pharm');
    expect(normalizeDescription('סופר פארם')).toBe('סופר פארם');
  });

  it('unifies gershayim and trailing punctuation in headers', () => {
    expect(normalizeHeader('סכום בש״ח')).toBe('סכום בש"ח');
    expect(normalizeHeader('Amount:')).toBe('amount');
    expect(normalizeHeader('שם בית\nעסק')).toBe('שם בית עסק');
  });
});
