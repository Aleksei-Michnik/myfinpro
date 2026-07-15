// Phase 6 · Iteration 6.11 — frontend wire types for the Transaction + Category API.
// Re-exports shared enums so the web app consumes a single source of truth
// (packages/shared), and declares the DTO-shaped interfaces returned by the
// NestJS controllers implemented in iterations 6.5–6.10.

export {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  TRANSACTION_FREQUENCIES,
  TRANSACTION_SORTS,
  TRANSACTION_PLAN_KINDS,
  AMORTIZATION_METHODS,
  CATEGORY_DIRECTIONS,
  CATEGORY_OWNER_TYPES,
  ATTRIBUTION_SCOPE_TYPES,
} from '@myfinpro/shared';

export type {
  TransactionDirection,
  TransactionType,
  TransactionStatus,
  TransactionFrequency,
  TransactionSort,
  TransactionPlanKind,
  AmortizationMethod,
  CategoryDirection,
  CategoryOwnerType,
  AttributionScope,
  AttributionScopeType,
} from '@myfinpro/shared';

import type { AttributionScope } from '@myfinpro/shared';

/** Inline category metadata returned on transaction responses. */
export interface TransactionCategorySummary {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
}

/** One attribution row as returned by the API (already resolved per-row). */
export interface TransactionAttribution {
  scope: 'personal' | 'group';
  userId: string | null;
  groupId: string | null;
  groupName: string | null;
}

/** Summary shape returned from list + single-item + mutation endpoints. */
export interface TransactionSummary {
  id: string;
  direction: 'IN' | 'OUT';
  /** Kept as plain string for forward compat with future transaction types. */
  type: string;
  amountCents: number;
  currency: string;
  /** ISO-8601 UTC timestamp. */
  occurredAt: string;
  status: string;
  category: TransactionCategorySummary;
  attributions: TransactionAttribution[];
  note: string | null;
  commentCount: number;
  starredByMe: boolean;
  hasDocuments: boolean;
  /** Source receipt when the transaction came from confirming one (7.13); loaded on the detail endpoint. */
  receiptId?: string | null;
  parentTransactionId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionListResponse {
  data: TransactionSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CommentAuthor {
  id: string;
  name: string;
}

export interface Comment {
  id: string;
  transactionId: string;
  author: CommentAuthor;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isMine: boolean;
}

export interface CommentListResponse {
  data: Comment[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  direction: 'IN' | 'OUT' | 'BOTH';
  ownerType: 'system' | 'user' | 'group';
  ownerId: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Request payload shapes (subset; will be extended in later iterations) ────

/**
 * Iteration 6.11 tightens `type` to `'ONE_TIME'` — the only kind that the
 * foundation UI will create. Later iterations (recurring / installment / plan)
 * will widen this union.
 */
export interface CreateTransactionInput {
  direction: 'IN' | 'OUT';
  /**
   * Iteration 6.18.1 widens the union to include `'RECURRING'`. The schedule
   * itself is created by a separate POST /transactions/:id/schedule call (see
   * the two-step create flow in `<TransactionFormDialog>`); the request body
   * therefore still carries no `schedule` payload.
   *
   * Iteration 6.20 adds the plan kinds — these DO carry an inline `plan`
   * body (single-step create; the API pre-generates the occurrence rows in
   * the same transaction).
   */
  type: 'ONE_TIME' | 'RECURRING' | 'INSTALLMENT' | 'LOAN' | 'MORTGAGE';
  amountCents: number;
  currency: string;
  occurredAt: string;
  categoryId: string;
  note?: string;
  attributions: AttributionScope[];
  schedule?: never;
  plan?: PlanSpec;
}

// ── Plan wire types (Phase 6 · Iteration 6.20) ──────────────────────────────

/**
 * Inline plan body on POST /transactions when type ∈ {INSTALLMENT, LOAN,
 * MORTGAGE}. The plan's principal is the transaction's own `amountCents` and its
 * kind is the transaction `type` — deliberately no separate fields.
 */
export interface PlanSpec {
  /** Annual rate as a decimal fraction (0.05 = 5%). Must be 0 for `equal`. */
  interestRate: number;
  /** 1..600. */
  transactionsCount: number;
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  /** ISO 8601 datetime. */
  firstDueAt: string;
  /** Defaults by kind: INSTALLMENT → 'equal', LOAN / MORTGAGE → 'french'. */
  amortizationMethod?: 'equal' | 'french';
}

/** One amortisation-table row served by GET /transactions/:id/plan. */
export interface PlanRow {
  index: number;
  dueAt: string;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  remainingCents: number;
  occurrenceId: string | null;
  status: string | null;
}

/** Wire shape returned by GET / DELETE /transactions/:id/plan. */
export interface PlanResponse {
  id: string;
  transactionId: string;
  kind: 'INSTALLMENT' | 'LOAN' | 'MORTGAGE';
  principalCents: number;
  interestRate: number;
  transactionsCount: number;
  frequency: PlanSpec['frequency'];
  firstDueAt: string;
  amortizationMethod: 'equal' | 'french';
  cancelledAt: string | null;
  createdAt: string;
  rows: PlanRow[];
}

// ── Schedule wire types (Phase 6 · Iteration 6.18.1) ────────────────────────

/**
 * Body shape for POST / PUT /transactions/:transactionId/schedule.
 *
 * Exactly one of `cron` / `everyMs` must be set — the API does the
 * authoritative cross-field check; client-side validation rejects the
 * obvious "both" / "neither" cases before the round trip.
 *
 * `everyMs` minimum is 60_000 (1 minute) in production. Tests / staging
 * may relax it via the `TRANSACTION_SCHEDULE_MIN_INTERVAL_MS` env knob.
 */
export interface ScheduleSpec {
  cron?: string;
  everyMs?: number;
  /** ISO 8601 datetime. */
  startsAt?: string;
  /** ISO 8601 datetime. `null`/`undefined` means no end. */
  endsAt?: string | null;
  /** ≥ 1. `null`/`undefined` means unlimited. */
  limit?: number | null;
}

/** Wire shape returned by all schedule endpoints. */
export interface ScheduleResponse {
  id: string;
  transactionId: string;
  cron: string | null;
  everyMs: number | null;
  startsAt: string;
  endsAt: string | null;
  limit: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Derived status used by the read-only `<ScheduleBadge>` (and, in 6.18.2,
 * the lifecycle buttons). `null` is returned when there is no schedule
 * attached at all so callers can render a neutral state.
 */
export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | null;

/**
 * Ordering matters: `cancelledAt` is terminal and wins over `pausedAt`
 * (a cancelled schedule will typically have both columns set if it was
 * paused first, then cancelled).
 */
export function deriveScheduleStatus(schedule: ScheduleResponse | null): ScheduleStatus {
  if (!schedule) return null;
  if (schedule.cancelledAt) return 'cancelled';
  if (schedule.pausedAt) return 'paused';
  return 'active';
}

/**
 * Edit-eligibility predicate consumed by `<TransactionDetailHeader>` and
 * `<TransactionRow>` (Phase 6 · Iteration 6.18.1.2).
 *
 * The form supports `ONE_TIME` and `RECURRING` (parent) types; everything
 * else (`INSTALLMENT` / `LOAN` / `MORTGAGE` / `LIMITED_PERIOD`) is still
 * read-only until the dedicated forms ship. Server-generated occurrences
 * (`parentTransactionId !== null`) stay non-editable per the
 * `TRANSACTION_CANNOT_EDIT_GENERATED_OCCURRENCE` rule; per-child overrides
 * land in 6.18.1.6.
 *
 * Authorisation (creator / co-owner) is layered separately by the caller —
 * this helper only reports whether the form *can technically* edit the
 * transaction.
 */
export type CannotEditReason = 'generatedOccurrence' | 'unsupportedType';

export function canEditTransaction(
  transaction: Pick<TransactionSummary, 'parentTransactionId' | 'type'>,
): boolean {
  if (transaction.parentTransactionId !== null) return false;
  return transaction.type === 'ONE_TIME' || transaction.type === 'RECURRING';
}

export function cannotEditReason(
  transaction: Pick<TransactionSummary, 'parentTransactionId' | 'type'>,
): CannotEditReason | null {
  if (transaction.parentTransactionId !== null) return 'generatedOccurrence';
  if (transaction.type !== 'ONE_TIME' && transaction.type !== 'RECURRING') return 'unsupportedType';
  return null;
}

export interface UpdateTransactionInput {
  direction?: 'IN' | 'OUT';
  type?: 'ONE_TIME' | 'RECURRING';
  amountCents?: number;
  currency?: string;
  occurredAt?: string;
  categoryId?: string;
  note?: string | null;
  attributions?: AttributionScope[];
}

/**
 * Propagation mode for editing a RECURRING parent's non-period fields
 * (Phase 6 · Iteration 6.18.1.5).
 *
 * - `self`   — update the parent record only.
 * - `future` — update the parent + every child occurrence with
 *              `occurredAt >= now` (server-evaluated).
 * - `all`    — update the parent + every child occurrence (past + future).
 */
export type TransactionPropagateMode = 'self' | 'future' | 'all';

export const TRANSACTION_PROPAGATE_MODES: readonly TransactionPropagateMode[] = [
  'self',
  'future',
  'all',
];

/**
 * Envelope returned by `PATCH /transactions/:id?propagate=...` (the cascade-edit
 * path). `affectedChildrenCount` is the number of child occurrences updated
 * in place; `skippedChildrenCount` is the number left untouched because they
 * carry an attribution to a group the editor does not control.
 */
export interface CascadeEditResult {
  transaction: TransactionSummary;
  affectedChildrenCount: number;
  skippedChildrenCount: number;
}

export interface ListTransactionsParams {
  /** `'all'`, `'personal'`, or `'group:<groupId>'`. */
  scope?: string;
  direction?: 'IN' | 'OUT';
  categoryId?: string;
  /** ISO date (YYYY-MM-DD) or timestamp. */
  from?: string;
  to?: string;
  starred?: boolean;
  type?: string;
  search?: string;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  limit?: number;
  cursor?: string;
  /** Iteration 6.18.1.3 — narrow to a single parent's occurrences. */
  parentTransactionId?: string;
  /** Iteration 6.18.1.3 — `true` parents only, `false` occurrences only. */
  withParent?: boolean;
}

/** Query knobs accepted by `useTransactions().listOccurrences()`. */
export interface ListOccurrencesParams {
  cursor?: string;
  limit?: number;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
}

export interface AttributionChangeResult {
  deletedAttributions: number;
  addedAttributions: number;
  transactionDeleted: boolean;
  transaction: TransactionSummary | null;
}

export interface ToggleStarResult {
  starred: boolean;
  starCount: number;
}

export interface ListCategoriesParams {
  direction?: 'IN' | 'OUT';
  /** `'personal'` or `'group:<groupId>'`. */
  scope?: string;
}

export interface ListCommentsParams {
  limit?: number;
  cursor?: string;
}
