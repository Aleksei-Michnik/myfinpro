// Phase 10, iteration 10.1 — budget enums + BudgetProgress shape.

import { describe, it, expect } from 'vitest';
import { BUDGET_PERIODS, BUDGET_ALERT_KINDS, type BudgetProgress } from '../types/budget.types';

describe('budget.types string-literal arrays', () => {
  it.each(Object.entries({ BUDGET_PERIODS, BUDGET_ALERT_KINDS }))(
    '%s is a non-empty readonly tuple of strings',
    (_name, arr) => {
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThan(0);
      for (const v of arr) expect(typeof v).toBe('string');
      // Roundtrip: cheap guarantee the values stay serialisable.
      expect(JSON.parse(JSON.stringify(arr))).toEqual([...arr]);
    },
  );

  it('BUDGET_PERIODS matches the design §4 set in order', () => {
    expect(BUDGET_PERIODS).toEqual(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM']);
  });

  it('BUDGET_ALERT_KINDS matches the design §4 set in order', () => {
    expect(BUDGET_ALERT_KINDS).toEqual(['BUDGET_THRESHOLD', 'BUDGET_OVERSPENT', 'PAYMENT_DUE']);
  });

  it('BudgetProgress compiles with the design §4 shape', () => {
    const progress: BudgetProgress = {
      budgetId: 'b-1',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      amountCents: 100_000,
      spentCents: 82_500,
      remainingCents: 17_500,
      pct: 82.5,
      excludedOtherCurrencyCount: 3,
    };
    expect(progress.remainingCents).toBe(progress.amountCents - progress.spentCents);
    expect(progress.excludedOtherCurrencyCount).toBe(3);
  });
});
