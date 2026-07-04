// Phase 6, iteration 6.19 — amortisation math against hand-calculated
// fixtures (design acceptance: 12×$100 for a $1200 0% installment; the
// $10,000 / 5% / 60-month loan matching the spreadsheet reference of
// $188.71/month with $41.67 first-month interest).

import {
  addMonthsAnchored,
  calculateAmortization,
  dueAtForIndex,
  PERIODS_PER_YEAR,
} from './amortization.util';

const D = (iso: string) => new Date(iso);

describe('amortization.util', () => {
  describe('addMonthsAnchored', () => {
    it('anchors to the original day-of-month across shorter months', () => {
      const first = D('2026-01-31T10:30:00.000Z');
      expect(addMonthsAnchored(first, 1).toISOString()).toBe('2026-02-28T10:30:00.000Z');
      // Back to a 31-day month → returns to the anchor day, no drift.
      expect(addMonthsAnchored(first, 2).toISOString()).toBe('2026-03-31T10:30:00.000Z');
    });

    it('handles leap-year February', () => {
      const first = D('2028-01-31T00:00:00.000Z');
      expect(addMonthsAnchored(first, 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    });

    it('crosses year boundaries', () => {
      const first = D('2026-11-15T00:00:00.000Z');
      expect(addMonthsAnchored(first, 3).toISOString()).toBe('2027-02-15T00:00:00.000Z');
    });
  });

  describe('dueAtForIndex', () => {
    it('DAILY / WEEKLY / BIWEEKLY use fixed-length steps', () => {
      const first = D('2026-05-01T00:00:00.000Z');
      expect(dueAtForIndex(first, 'DAILY', 3).toISOString()).toBe('2026-05-03T00:00:00.000Z');
      expect(dueAtForIndex(first, 'WEEKLY', 2).toISOString()).toBe('2026-05-08T00:00:00.000Z');
      expect(dueAtForIndex(first, 'BIWEEKLY', 2).toISOString()).toBe('2026-05-15T00:00:00.000Z');
    });

    it('MONTHLY / QUARTERLY / ANNUAL use anchored month math', () => {
      const first = D('2026-01-31T00:00:00.000Z');
      expect(dueAtForIndex(first, 'MONTHLY', 2).toISOString()).toBe('2026-02-28T00:00:00.000Z');
      expect(dueAtForIndex(first, 'QUARTERLY', 2).toISOString()).toBe('2026-04-30T00:00:00.000Z');
      expect(dueAtForIndex(first, 'ANNUAL', 2).toISOString()).toBe('2027-01-31T00:00:00.000Z');
    });

    it('index 1 is always the first due date itself', () => {
      const first = D('2026-05-10T12:00:00.000Z');
      for (const f of Object.keys(PERIODS_PER_YEAR) as (keyof typeof PERIODS_PER_YEAR)[]) {
        expect(dueAtForIndex(first, f, 1).toISOString()).toBe(first.toISOString());
      }
    });
  });

  describe("method 'equal' (zero-interest installments)", () => {
    it('acceptance: $1200 over 12 → twelve rows of exactly $100', () => {
      const rows = calculateAmortization({
        principalCents: 120_000,
        interestRate: 0,
        paymentsCount: 12,
        method: 'equal',
        firstDueAt: D('2026-06-01T00:00:00.000Z'),
        frequency: 'MONTHLY',
      });
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.principalCents).toBe(10_000);
        expect(row.interestCents).toBe(0);
        expect(row.totalCents).toBe(10_000);
      }
      expect(rows[11].remainingCents).toBe(0);
      expect(rows[0].dueAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(rows[11].dueAt.toISOString()).toBe('2027-05-01T00:00:00.000Z');
    });

    it('distributes a non-divisible remainder one cent at a time, first rows first', () => {
      const rows = calculateAmortization({
        principalCents: 1000,
        interestRate: 0,
        paymentsCount: 3,
        method: 'equal',
        firstDueAt: D('2026-06-01T00:00:00.000Z'),
        frequency: 'MONTHLY',
      });
      expect(rows.map((r) => r.principalCents)).toEqual([334, 333, 333]);
      expect(rows.map((r) => r.remainingCents)).toEqual([666, 333, 0]);
      expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(1000);
    });

    it('single-payment plan is one row for the whole principal', () => {
      const rows = calculateAmortization({
        principalCents: 55_555,
        interestRate: 0,
        paymentsCount: 1,
        method: 'equal',
        firstDueAt: D('2026-06-01T00:00:00.000Z'),
        frequency: 'MONTHLY',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        principalCents: 55_555,
        interestCents: 0,
        totalCents: 55_555,
        remainingCents: 0,
      });
    });

    it("rejects interestRate > 0 for method 'equal'", () => {
      expect(() =>
        calculateAmortization({
          principalCents: 1000,
          interestRate: 0.05,
          paymentsCount: 3,
          method: 'equal',
          firstDueAt: D('2026-06-01T00:00:00.000Z'),
          frequency: 'MONTHLY',
        }),
      ).toThrow(RangeError);
    });
  });

  describe("method 'french' (annuity)", () => {
    it('acceptance: $10,000 at 5% over 60 months matches the spreadsheet reference', () => {
      const rows = calculateAmortization({
        principalCents: 1_000_000,
        interestRate: 0.05,
        paymentsCount: 60,
        method: 'french',
        firstDueAt: D('2026-06-01T00:00:00.000Z'),
        frequency: 'MONTHLY',
      });
      expect(rows).toHaveLength(60);
      // Reference annuity: P·r/(1−(1+r)^−n), r = 0.05/12 → $188.71/month.
      expect(rows[0].totalCents).toBe(18_871);
      // First-month interest on the full balance: 1_000_000 × 0.05/12 = $41.67.
      expect(rows[0].interestCents).toBe(4_167);
      expect(rows[0].principalCents).toBe(14_704);
      expect(rows[0].remainingCents).toBe(985_296);
      // Every non-final row pays the constant annuity.
      for (const row of rows.slice(0, -1)) {
        expect(row.totalCents).toBe(18_871);
        expect(row.totalCents).toBe(row.principalCents + row.interestCents);
      }
      // Principal sums exactly; balance closes on 0.
      expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(1_000_000);
      expect(rows[59].remainingCents).toBe(0);
      // The final row absorbs rounding — it stays within a few cents of the
      // constant annuity (reference spreadsheet: $188.83 due to per-row
      // rounding accumulation).
      expect(Math.abs(rows[59].totalCents - 18_871)).toBeLessThan(25);
      // Interest declines monotonically on a fixed-rate annuity.
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].interestCents).toBeLessThanOrEqual(rows[i - 1].interestCents);
      }
    });

    it('zero rate degenerates to the equal split', () => {
      const rows = calculateAmortization({
        principalCents: 120_000,
        interestRate: 0,
        paymentsCount: 12,
        method: 'french',
        firstDueAt: D('2026-06-01T00:00:00.000Z'),
        frequency: 'MONTHLY',
      });
      expect(rows.every((r) => r.totalCents === 10_000 && r.interestCents === 0)).toBe(true);
    });

    it('weekly frequency divides the annual rate by 52', () => {
      const rows = calculateAmortization({
        principalCents: 100_000,
        interestRate: 0.052, // exactly 0.1% per week
        paymentsCount: 10,
        method: 'french',
        firstDueAt: D('2026-06-01T00:00:00.000Z'),
        frequency: 'WEEKLY',
      });
      expect(rows[0].interestCents).toBe(100); // 100_000 × 0.001
      expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(100_000);
      expect(rows[9].remainingCents).toBe(0);
    });

    it('invariants hold across a randomized-but-fixed grid of inputs', () => {
      const grid = [
        { principalCents: 33_333, rate: 0.199, count: 7 },
        { principalCents: 1, rate: 0.5, count: 1 },
        { principalCents: 999_999_99, rate: 0.035, count: 360 },
        { principalCents: 101, rate: 0.9, count: 5 },
      ];
      for (const g of grid) {
        const rows = calculateAmortization({
          principalCents: g.principalCents,
          interestRate: g.rate,
          paymentsCount: g.count,
          method: 'french',
          firstDueAt: D('2026-06-01T00:00:00.000Z'),
          frequency: 'MONTHLY',
        });
        expect(rows).toHaveLength(g.count);
        expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(g.principalCents);
        expect(rows[rows.length - 1].remainingCents).toBe(0);
        for (const row of rows) {
          expect(row.principalCents).toBeGreaterThanOrEqual(0);
          expect(row.interestCents).toBeGreaterThanOrEqual(0);
          expect(row.totalCents).toBe(row.principalCents + row.interestCents);
        }
      }
    });
  });

  describe('input validation', () => {
    const valid = {
      principalCents: 1000,
      interestRate: 0,
      paymentsCount: 2,
      method: 'equal' as const,
      firstDueAt: D('2026-06-01T00:00:00.000Z'),
      frequency: 'MONTHLY' as const,
    };

    it.each([
      ['zero principal', { ...valid, principalCents: 0 }],
      ['negative principal', { ...valid, principalCents: -5 }],
      ['fractional principal', { ...valid, principalCents: 10.5 }],
      ['zero count', { ...valid, paymentsCount: 0 }],
      ['fractional count', { ...valid, paymentsCount: 2.5 }],
      ['negative rate', { ...valid, interestRate: -0.01 }],
      ['NaN rate', { ...valid, interestRate: Number.NaN }],
      ['invalid date', { ...valid, firstDueAt: new Date('bogus') }],
    ])('rejects %s', (_label, input) => {
      expect(() => calculateAmortization(input)).toThrow(RangeError);
    });
  });
});
