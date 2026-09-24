import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_INSTITUTIONS,
  INSTITUTION_META,
  type AccountInstitution,
} from '../constants/institutions';
import {
  ACCOUNT_IMPORT_MAX_LINES,
  ACCOUNT_IMPORT_SOURCES,
  ACCOUNT_KINDS,
  ACCOUNT_LAST4_PATTERN,
  STATEMENT_LINE_STATUSES,
  STATEMENT_MATCH_CONFIDENT_SCORE,
  STATEMENT_MATCH_DATE_WINDOW_DAYS,
  STATEMENT_SUGGESTED_ACTIONS,
} from '../types/account.types';

describe('account enums', () => {
  it('exposes the four account kinds', () => {
    expect([...ACCOUNT_KINDS]).toEqual(['BANK', 'CARD', 'CASH', 'OTHER']);
  });

  it('statement lifecycle and suggested actions are closed lists', () => {
    expect([...STATEMENT_LINE_STATUSES]).toEqual(['PENDING', 'MATCHED', 'CREATED', 'IGNORED']);
    expect([...STATEMENT_SUGGESTED_ACTIONS]).toEqual(['match', 'transfer', 'create', 'none']);
  });

  it('every value in each list is unique', () => {
    for (const list of [
      ACCOUNT_KINDS,
      ACCOUNT_INSTITUTIONS,
      ACCOUNT_IMPORT_SOURCES,
      STATEMENT_LINE_STATUSES,
      STATEMENT_SUGGESTED_ACTIONS,
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('import sources cover every institution that ships a statement preset', () => {
    const sources = new Set<string>(ACCOUNT_IMPORT_SOURCES);
    expect(sources.has('generic_csv')).toBe(true);
    expect(sources.has('manual')).toBe(true);
    expect(sources.has('connector')).toBe(true);
    for (const source of ACCOUNT_IMPORT_SOURCES) {
      if (['generic_csv', 'manual', 'connector'].includes(source)) continue;
      expect(ACCOUNT_INSTITUTIONS).toContain(source);
    }
  });

  it('tuning constants match the design', () => {
    expect(ACCOUNT_IMPORT_MAX_LINES).toBe(2000);
    expect(STATEMENT_MATCH_DATE_WINDOW_DAYS).toBe(5);
    expect(STATEMENT_MATCH_CONFIDENT_SCORE).toBe(0.8);
  });
});

describe('ACCOUNT_LAST4_PATTERN', () => {
  it('accepts 2 to 4 digits', () => {
    for (const value of ['12', '123', '1234', '0007']) {
      expect(ACCOUNT_LAST4_PATTERN.test(value)).toBe(true);
    }
  });

  it('rejects anything longer, shorter or non-numeric', () => {
    for (const value of ['1', '12345', '', 'abcd', '12a', ' 123', '12 ']) {
      expect(ACCOUNT_LAST4_PATTERN.test(value)).toBe(false);
    }
  });

  it('is stateless (no global flag) so repeated tests agree', () => {
    expect(ACCOUNT_LAST4_PATTERN.flags).toBe('');
    expect(ACCOUNT_LAST4_PATTERN.test('1234')).toBe(true);
    expect(ACCOUNT_LAST4_PATTERN.test('1234')).toBe(true);
  });
});

describe('INSTITUTION_META', () => {
  it('has exactly one entry per institution', () => {
    expect(Object.keys(INSTITUTION_META).sort()).toEqual([...ACCOUNT_INSTITUTIONS].sort());
  });

  it('every entry has a non-empty name and at least one kind', () => {
    for (const key of ACCOUNT_INSTITUTIONS) {
      const meta = INSTITUTION_META[key];
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.kinds.length).toBeGreaterThan(0);
      for (const kind of meta.kinds) expect(ACCOUNT_KINDS).toContain(kind);
    }
  });

  it('card issuers carry bill tokens in Hebrew and Latin script', () => {
    const issuers: AccountInstitution[] = ['isracard', 'cal', 'max', 'amex'];
    for (const key of issuers) {
      const meta = INSTITUTION_META[key];
      expect(meta.kinds).toContain('CARD');
      const tokens = meta.billTokens ?? [];
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.some((t) => /[֐-׿]/.test(t))).toBe(true);
      expect(tokens.some((t) => /^[A-Z. ]+$/.test(t))).toBe(true);
    }
  });

  it('`other` accepts every kind so nothing is unrepresentable', () => {
    expect(INSTITUTION_META.other.kinds).toEqual([...ACCOUNT_KINDS]);
  });
});
