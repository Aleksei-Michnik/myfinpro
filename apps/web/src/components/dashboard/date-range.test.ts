import { describe, expect, it } from 'vitest';
import { computeMonthRange } from './date-range';

describe('computeMonthRange', () => {
  it('returns first-of-current-month and first-of-next-month at UTC midnight', () => {
    const now = new Date(Date.UTC(2026, 4, 15, 12, 34, 56)); // 15 May 2026
    const { fromIso, toIso } = computeMonthRange(now);
    expect(fromIso).toBe('2026-05-01T00:00:00.000Z');
    expect(toIso).toBe('2026-06-01T00:00:00.000Z');
  });

  it('handles January boundary (month overflows to February)', () => {
    const now = new Date(Date.UTC(2026, 0, 5)); // Jan
    const { fromIso, toIso } = computeMonthRange(now);
    expect(fromIso).toBe('2026-01-01T00:00:00.000Z');
    expect(toIso).toBe('2026-02-01T00:00:00.000Z');
  });

  it('handles December boundary (rolls into next year January)', () => {
    const now = new Date(Date.UTC(2026, 11, 31, 23, 59, 59)); // Dec 31 2026
    const { fromIso, toIso } = computeMonthRange(now);
    expect(fromIso).toBe('2026-12-01T00:00:00.000Z');
    expect(toIso).toBe('2027-01-01T00:00:00.000Z');
  });

  it('respects a custom `now` argument (no implicit Date.now())', () => {
    const a = computeMonthRange(new Date(Date.UTC(2024, 1, 29))); // leap-year Feb
    expect(a.fromIso).toBe('2024-02-01T00:00:00.000Z');
    expect(a.toIso).toBe('2024-03-01T00:00:00.000Z');
  });

  it('defaults to "now" when called without arguments', () => {
    const { fromIso, toIso } = computeMonthRange();
    expect(/^\d{4}-\d{2}-01T00:00:00\.000Z$/.test(fromIso)).toBe(true);
    expect(/^\d{4}-\d{2}-01T00:00:00\.000Z$/.test(toIso)).toBe(true);
    expect(new Date(toIso).getTime()).toBeGreaterThan(new Date(fromIso).getTime());
  });
});
