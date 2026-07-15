import { describe, expect, it, vi } from 'vitest';
import {
  formatAmount,
  formatOccurredAt,
  formatOccurredAtAbsolute,
  formatOccurredDate,
  formatScopeLabel,
  formatSignedAmount,
} from '../formatters';
import type { TransactionSummary } from '../types';

describe('formatAmount', () => {
  it('formats USD in en-US with narrow symbol', () => {
    expect(formatAmount(1250, 'USD', 'en-US')).toContain('12.50');
    expect(formatAmount(1250, 'USD', 'en-US')).toContain('$');
  });

  it('formats EUR in de-DE', () => {
    // de-DE uses comma decimal + trailing € (NBSP between)
    const s = formatAmount(1250, 'EUR', 'de-DE');
    expect(s).toMatch(/12,50/);
    expect(s).toContain('€');
  });

  it('formats ILS in he-IL', () => {
    const s = formatAmount(1250, 'ILS', 'he-IL');
    expect(s).toContain('12.50');
    expect(s).toMatch(/₪/);
  });

  it('handles zero cents', () => {
    expect(formatAmount(0, 'USD', 'en-US')).toContain('0.00');
  });

  it('formats negative amounts with a leading minus', () => {
    expect(formatAmount(-500, 'USD', 'en-US')).toMatch(/^-/);
  });

  it('always emits exactly two fraction digits', () => {
    expect(formatAmount(1, 'USD', 'en-US')).toContain('0.01');
    expect(formatAmount(100, 'USD', 'en-US')).toContain('1.00');
  });
});

describe('formatSignedAmount', () => {
  const baseTransaction: Pick<TransactionSummary, 'amountCents' | 'currency' | 'direction'> = {
    amountCents: 1250,
    currency: 'USD',
    direction: 'OUT',
  };

  it('prefixes "-" for OUT direction', () => {
    expect(formatSignedAmount(baseTransaction, 'en-US').startsWith('-')).toBe(true);
  });

  it('prefixes "+" for IN direction', () => {
    expect(
      formatSignedAmount({ ...baseTransaction, direction: 'IN' }, 'en-US').startsWith('+'),
    ).toBe(true);
  });

  it('strips existing "-" emitted by Intl before re-prefixing', () => {
    // Math.abs is applied internally, so the sign is always ours.
    const out = formatSignedAmount({ ...baseTransaction, amountCents: -1250 }, 'en-US');
    expect(out.startsWith('-')).toBe(true);
    expect(out.slice(1).startsWith('-')).toBe(false);
    expect(out.slice(1).startsWith('+')).toBe(false);
  });
});

describe('formatOccurredAt', () => {
  it('returns a non-empty localised date for a valid ISO string', () => {
    const s = formatOccurredAt('2026-04-25T12:00:00Z', 'en-US');
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/2026/);
  });

  it('returns an empty string for an unparseable input', () => {
    expect(formatOccurredAt('not-a-date', 'en-US')).toBe('');
  });

  // Phase 6 · Iteration 6.18.1.2 — the default formatter now embeds the
  // time of day. We assert via a `H:MM` regex so the test stays
  // timezone-agnostic (CI runs in UTC; local devs may be elsewhere).
  it('includes the time component in the en-US output', () => {
    const s = formatOccurredAt('2026-05-19T14:30:00Z', 'en-US');
    expect(s).toMatch(/\d{1,2}:\d{2}/);
    expect(s).toMatch(/2026/);
  });

  it('includes the time component in the he-IL output (RTL-safe)', () => {
    const s = formatOccurredAt('2026-05-19T14:30:00Z', 'he-IL');
    expect(s).toMatch(/\d{1,2}:\d{2}/);
    expect(s).toMatch(/2026/);
  });

  it('does not suppress midnight — `00:00` / `12:00` still renders', () => {
    const s = formatOccurredAt('2026-05-19T00:00:00Z', 'en-US');
    expect(s).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('formatOccurredDate', () => {
  it('renders date only (no time component) for surfaces that opt out', () => {
    const s = formatOccurredDate('2026-05-19T14:30:00Z', 'en-US');
    expect(s).toMatch(/2026/);
    // Exhaustive: no `H:MM`-style time present.
    expect(s).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns an empty string for an unparseable input', () => {
    expect(formatOccurredDate('not-a-date', 'en-US')).toBe('');
  });
});

describe('formatOccurredAtAbsolute', () => {
  it('emits a fully-qualified date+time tooltip string', () => {
    const s = formatOccurredAtAbsolute('2026-05-19T14:30:00Z', 'en-US');
    expect(s).toMatch(/2026/);
    expect(s).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns an empty string for an unparseable input', () => {
    expect(formatOccurredAtAbsolute('not-a-date', 'en-US')).toBe('');
  });
});

describe('formatScopeLabel', () => {
  const t = vi.fn((key: string) => `t:${key}`);

  it('personal scope calls t(scope.personal) — relative key, namespaced t', () => {
    expect(formatScopeLabel({ scope: 'personal', groupName: null }, t)).toBe('t:scope.personal');
  });

  it('group scope with a name returns the name verbatim', () => {
    expect(formatScopeLabel({ scope: 'group', groupName: 'Family' }, t)).toBe('Family');
  });

  it('group scope with null name falls back to t(scope.group)', () => {
    expect(formatScopeLabel({ scope: 'group', groupName: null }, t)).toBe('t:scope.group');
  });

  it('never invokes `t` with a doubled `transactions.` prefix (regression for 6.15.2)', () => {
    const spy = vi.fn((key: string) => key);
    formatScopeLabel({ scope: 'personal', groupName: null }, spy);
    formatScopeLabel({ scope: 'group', groupName: null }, spy);
    for (const call of spy.mock.calls) {
      expect(call[0]).not.toMatch(/^transactions\./);
    }
  });
});
