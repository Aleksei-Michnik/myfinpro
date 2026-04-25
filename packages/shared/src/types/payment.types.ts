// Phase 6: Payment Management — shared enums and primitive shapes.
// Used by both apps/api (DTO validation, service logic) and apps/web (forms, filters, types).

export const PAYMENT_DIRECTIONS = ['IN', 'OUT'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const PAYMENT_TYPES = [
  'ONE_TIME',
  'RECURRING',
  'LIMITED_PERIOD',
  'INSTALLMENT',
  'LOAN',
  'MORTGAGE',
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_STATUSES = ['POSTED', 'PENDING', 'DUE', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const CATEGORY_OWNER_TYPES = ['system', 'user', 'group'] as const;
export type CategoryOwnerType = (typeof CATEGORY_OWNER_TYPES)[number];

// 'BOTH' is a legitimate category direction — covers categories usable for both IN and OUT (e.g. "other").
export const CATEGORY_DIRECTIONS = ['IN', 'OUT', 'BOTH'] as const;
export type CategoryDirection = (typeof CATEGORY_DIRECTIONS)[number];

export const ATTRIBUTION_SCOPE_TYPES = ['personal', 'group'] as const;
export type AttributionScopeType = (typeof ATTRIBUTION_SCOPE_TYPES)[number];

/** Discriminated union expressing one attribution target (used in POST /payments body). */
export type AttributionScope = { scope: 'personal' } | { scope: 'group'; groupId: string };

export const PAYMENT_SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

/** Amortisation methods supported by PaymentPlan. */
export const AMORTIZATION_METHODS = ['equal', 'french'] as const;
export type AmortizationMethod = (typeof AMORTIZATION_METHODS)[number];

export const PAYMENT_PLAN_KINDS = ['INSTALLMENT', 'LOAN', 'MORTGAGE'] as const;
export type PaymentPlanKind = (typeof PAYMENT_PLAN_KINDS)[number];
