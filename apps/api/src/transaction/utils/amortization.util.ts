// Phase 6, iteration 6.19 — pure amortisation math for TransactionPlan.
//
// Two methods (design §2.2 / §5.6):
//   - `equal`  — zero-interest split: principal divided into N integer-cent
//                rows; the first `principal % N` rows carry one extra cent so
//                the rows sum to the principal EXACTLY.
//   - `french` — classic annuity: constant per-period transaction
//                A = P·r / (1 − (1+r)^−n) with per-period rate
//                r = annualRate / periodsPerYear. Interest is computed on the
//                declining balance and rounded per row; the LAST row absorbs
//                all accumulated rounding so the balance lands on exactly 0.
//
// All money values are integer cents (dna rule: never float a stored amount);
// floats appear only in the intermediate annuity math and are rounded once
// per row. Dates are UTC; month-based frequencies anchor to the first due
// date's day-of-month and clamp to shorter months (Jan 31 → Feb 28 → Mar 31).

import type { AmortizationMethod, TransactionFrequency } from '@myfinpro/shared';

export interface AmortizationInput {
  principalCents: number;
  /** Annual rate as a decimal fraction (0.05 = 5%). Must be 0 for `equal`. */
  interestRate: number;
  transactionsCount: number;
  method: AmortizationMethod;
  firstDueAt: Date;
  frequency: TransactionFrequency;
}

export interface AmortizationRow {
  /** 1-based row index. */
  index: number;
  dueAt: Date;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  /** Principal still outstanding AFTER this row is paid. */
  remainingCents: number;
}

/** Periods per year for each supported plan frequency. */
export const PERIODS_PER_YEAR: Record<TransactionFrequency, number> = {
  DAILY: 365,
  WEEKLY: 52,
  BIWEEKLY: 26,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUAL: 1,
};

const MS_PER_DAY = 86_400_000;

/**
 * Add `months` calendar months to `first`, anchored to the ORIGINAL
 * day-of-month (not the previous row's, which would drift after a clamp):
 * Jan 31 → Feb 28 → Mar 31, not Mar 28. Time-of-day is preserved. UTC.
 */
export function addMonthsAnchored(first: Date, months: number): Date {
  const anchorDay = first.getUTCDate();
  const target = new Date(
    Date.UTC(
      first.getUTCFullYear(),
      first.getUTCMonth() + months,
      1,
      first.getUTCHours(),
      first.getUTCMinutes(),
      first.getUTCSeconds(),
      first.getUTCMilliseconds(),
    ),
  );
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, daysInTargetMonth));
  return target;
}

/** Due date of the 1-based `index`-th row. */
export function dueAtForIndex(
  firstDueAt: Date,
  frequency: TransactionFrequency,
  index: number,
): Date {
  const steps = index - 1;
  switch (frequency) {
    case 'DAILY':
      return new Date(firstDueAt.getTime() + steps * MS_PER_DAY);
    case 'WEEKLY':
      return new Date(firstDueAt.getTime() + steps * 7 * MS_PER_DAY);
    case 'BIWEEKLY':
      return new Date(firstDueAt.getTime() + steps * 14 * MS_PER_DAY);
    case 'MONTHLY':
      return addMonthsAnchored(firstDueAt, steps);
    case 'QUARTERLY':
      return addMonthsAnchored(firstDueAt, steps * 3);
    case 'ANNUAL':
      return addMonthsAnchored(firstDueAt, steps * 12);
  }
}

/**
 * Compute the full amortisation schedule. Pure and deterministic — throws
 * `RangeError` on invalid inputs (the service layer translates these into
 * structured 400s before they can reach Prisma).
 *
 * Invariants guaranteed on the result:
 *   - rows.length === transactionsCount
 *   - Σ principalCents === input.principalCents (exactly)
 *   - remainingCents of the last row === 0
 *   - every totalCents === principalCents + interestCents
 */
export function calculateAmortization(input: AmortizationInput): AmortizationRow[] {
  const { principalCents, interestRate, transactionsCount, method, firstDueAt, frequency } = input;

  if (!Number.isInteger(principalCents) || principalCents <= 0) {
    throw new RangeError('principalCents must be a positive integer');
  }
  if (!Number.isInteger(transactionsCount) || transactionsCount <= 0) {
    throw new RangeError('transactionsCount must be a positive integer');
  }
  if (!Number.isFinite(interestRate) || interestRate < 0) {
    throw new RangeError('interestRate must be a non-negative finite number');
  }
  if (method === 'equal' && interestRate !== 0) {
    throw new RangeError("method 'equal' requires interestRate === 0");
  }
  if (Number.isNaN(firstDueAt.getTime())) {
    throw new RangeError('firstDueAt must be a valid date');
  }

  const rows: AmortizationRow[] = [];

  // Zero-interest split — also the degenerate french case (r === 0).
  const perPeriodRate = interestRate / PERIODS_PER_YEAR[frequency];
  if (method === 'equal' || perPeriodRate === 0) {
    const base = Math.floor(principalCents / transactionsCount);
    const extraCents = principalCents - base * transactionsCount;
    let remaining = principalCents;
    for (let i = 1; i <= transactionsCount; i++) {
      const principal = base + (i <= extraCents ? 1 : 0);
      remaining -= principal;
      rows.push({
        index: i,
        dueAt: dueAtForIndex(firstDueAt, frequency, i),
        principalCents: principal,
        interestCents: 0,
        totalCents: principal,
        remainingCents: remaining,
      });
    }
    return rows;
  }

  // French annuity. Constant transaction rounded once; per-row interest rounded
  // on the declining balance; final row absorbs the rounding drift.
  const r = perPeriodRate;
  const n = transactionsCount;
  const annuity = Math.round((principalCents * r) / (1 - Math.pow(1 + r, -n)));

  let remaining = principalCents;
  for (let i = 1; i <= n; i++) {
    const interest = Math.round(remaining * r);
    let principal: number;
    if (i === n) {
      // Close out exactly — the last principal is whatever is left.
      principal = remaining;
    } else {
      principal = Math.min(annuity - interest, remaining);
      // Pathological corner (huge rate + tiny principal): never let a
      // non-final row take the balance to zero early; leave 1 cent so the
      // schedule keeps its promised length.
      if (principal >= remaining && i < n) principal = remaining - 1;
      if (principal < 0) principal = 0;
    }
    remaining -= principal;
    rows.push({
      index: i,
      dueAt: dueAtForIndex(firstDueAt, frequency, i),
      principalCents: principal,
      interestCents: interest,
      totalCents: principal + interest,
      remainingCents: remaining,
    });
  }
  return rows;
}
