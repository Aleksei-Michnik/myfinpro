// Phase 10: Budgets & Spending Targets — shared enums and primitive shapes.
// Used by apps/api (DTO validation, alert worker) and apps/web (forms,
// progress bars, "resets in N days" labels).
// See docs/phase-10-budgets-design.md §4.

export const BUDGET_PERIODS = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const BUDGET_ALERT_KINDS = [
  'BUDGET_THRESHOLD',
  'BUDGET_OVERSPENT',
  'TRANSACTION_DUE',
] as const;
export type BudgetAlertKind = (typeof BUDGET_ALERT_KINDS)[number];

/**
 * Derived (never stored) progress of one budget over one period window
 * (design §2.2). Only transactions in the budget's own currency count —
 * `excludedOtherCurrencyCount` lets the UI hint about the rest (§2.4).
 */
export interface BudgetProgress {
  budgetId: string;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601 (exclusive)
  amountCents: number;
  spentCents: number;
  remainingCents: number; // amount − spent, may be negative
  pct: number; // 0..∞, rounded to 1 decimal
  excludedOtherCurrencyCount: number; // §2.4
}
