// Phase 10 · Iteration 10.3 — frontend wire types for the Budget API
// (apps/api/src/budget). Re-exports the shared period enum so the web app
// consumes a single source of truth (packages/shared) and declares the
// DTO-shaped interfaces returned by the NestJS controller shipped in 10.2.

export { BUDGET_PERIODS } from '@myfinpro/shared';
export type { BudgetPeriod } from '@myfinpro/shared';

import type { BudgetPeriod } from '@myfinpro/shared';
import type { TransactionCategorySummary } from '@/lib/transaction/types';

/** Budget shape returned by every /budgets endpoint (BudgetResponseDto). */
export interface BudgetSummary {
  id: string;
  name: string;
  /** Target amount in minor units (cents). */
  amountCents: number;
  currency: string;
  scopeType: 'personal' | 'group';
  ownerId: string | null;
  groupId: string | null;
  categoryId: string | null;
  /** Same compact category shape transactions expose. */
  category: TransactionCategorySummary | null;
  period: BudgetPeriod;
  /** CUSTOM only (ISO 8601); null for repeating periods. */
  startsAt: string | null;
  /** CUSTOM only (ISO 8601, exclusive). */
  endsAt: string | null;
  /** 1..100; null = no threshold alert. */
  alertThresholdPct: number | null;
  alertOverspend: boolean;
  archivedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetListResponse {
  data: BudgetSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** POST /budgets body (CreateBudgetDto). */
export interface CreateBudgetInput {
  name: string;
  amountCents: number;
  /** Defaults to the owner's / group's defaultCurrency when omitted. */
  currency?: string;
  scopeType: 'personal' | 'group';
  /** Required when scopeType=group; forbidden otherwise. */
  groupId?: string;
  categoryId?: string;
  period: BudgetPeriod;
  /** CUSTOM only — ISO 8601 period start (inclusive). */
  startsAt?: string;
  /** CUSTOM only — ISO 8601 period end (exclusive). */
  endsAt?: string;
  alertThresholdPct?: number;
  alertOverspend?: boolean;
}

/**
 * PATCH /budgets/:id body (UpdateBudgetDto). Scope is immutable — recreate
 * the budget to move it. Nullable fields accept explicit `null` to clear.
 */
export interface UpdateBudgetInput {
  name?: string;
  amountCents?: number;
  currency?: string;
  categoryId?: string | null;
  period?: BudgetPeriod;
  startsAt?: string | null;
  endsAt?: string | null;
  alertThresholdPct?: number | null;
  alertOverspend?: boolean;
}

export interface ListBudgetsParams {
  /** `'all'`, `'personal'`, or `'group:<groupId>'`. Default 'all'. */
  scope?: string;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}
