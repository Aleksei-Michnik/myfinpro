// Phase 6: Transaction Management — shared enums and primitive shapes.
// Used by both apps/api (DTO validation, service logic) and apps/web (forms, filters, types).

export const TRANSACTION_DIRECTIONS = ['IN', 'OUT'] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const TRANSACTION_TYPES = [
  'ONE_TIME',
  'RECURRING',
  'LIMITED_PERIOD',
  'INSTALLMENT',
  'LOAN',
  'MORTGAGE',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['POSTED', 'PENDING', 'DUE', 'CANCELLED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
] as const;
export type TransactionFrequency = (typeof TRANSACTION_FREQUENCIES)[number];

export const CATEGORY_OWNER_TYPES = ['system', 'user', 'group'] as const;
export type CategoryOwnerType = (typeof CATEGORY_OWNER_TYPES)[number];

// 'BOTH' is a legitimate category direction — covers categories usable for both IN and OUT (e.g. "other").
export const CATEGORY_DIRECTIONS = ['IN', 'OUT', 'BOTH'] as const;
export type CategoryDirection = (typeof CATEGORY_DIRECTIONS)[number];

export const ATTRIBUTION_SCOPE_TYPES = ['personal', 'group'] as const;
export type AttributionScopeType = (typeof ATTRIBUTION_SCOPE_TYPES)[number];

/** Discriminated union expressing one attribution target (used in POST /transactions body). */
export type AttributionScope = { scope: 'personal' } | { scope: 'group'; groupId: string };

export const TRANSACTION_SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

/** Amortisation methods supported by TransactionPlan. */
export const AMORTIZATION_METHODS = ['equal', 'french'] as const;
export type AmortizationMethod = (typeof AMORTIZATION_METHODS)[number];

export const TRANSACTION_PLAN_KINDS = ['INSTALLMENT', 'LOAN', 'MORTGAGE'] as const;
export type TransactionPlanKind = (typeof TRANSACTION_PLAN_KINDS)[number];

/** Type guard: does this transaction type carry an amortisation plan? */
export function isPlanKind(type: string): type is TransactionPlanKind {
  return (TRANSACTION_PLAN_KINDS as readonly string[]).includes(type);
}
