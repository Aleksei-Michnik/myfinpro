// Phase 6 · Iteration 6.11 — frontend wire types for the Payment + Category API.
// Re-exports shared enums so the web app consumes a single source of truth
// (packages/shared), and declares the DTO-shaped interfaces returned by the
// NestJS controllers implemented in iterations 6.5–6.10.

export {
  PAYMENT_DIRECTIONS,
  PAYMENT_TYPES,
  PAYMENT_STATUSES,
  PAYMENT_FREQUENCIES,
  PAYMENT_SORTS,
  PAYMENT_PLAN_KINDS,
  AMORTIZATION_METHODS,
  CATEGORY_DIRECTIONS,
  CATEGORY_OWNER_TYPES,
  ATTRIBUTION_SCOPE_TYPES,
} from '@myfinpro/shared';

export type {
  PaymentDirection,
  PaymentType,
  PaymentStatus,
  PaymentFrequency,
  PaymentSort,
  PaymentPlanKind,
  AmortizationMethod,
  CategoryDirection,
  CategoryOwnerType,
  AttributionScope,
  AttributionScopeType,
} from '@myfinpro/shared';

import type { AttributionScope } from '@myfinpro/shared';

/** Inline category metadata returned on payment responses. */
export interface PaymentCategorySummary {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
}

/** One attribution row as returned by the API (already resolved per-row). */
export interface PaymentAttribution {
  scope: 'personal' | 'group';
  userId: string | null;
  groupId: string | null;
  groupName: string | null;
}

/** Summary shape returned from list + single-item + mutation endpoints. */
export interface PaymentSummary {
  id: string;
  direction: 'IN' | 'OUT';
  /** Kept as plain string for forward compat with future payment types. */
  type: string;
  amountCents: number;
  currency: string;
  /** ISO-8601 UTC timestamp. */
  occurredAt: string;
  status: string;
  category: PaymentCategorySummary;
  attributions: PaymentAttribution[];
  note: string | null;
  commentCount: number;
  starredByMe: boolean;
  hasDocuments: boolean;
  parentPaymentId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentListResponse {
  data: PaymentSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CommentAuthor {
  id: string;
  name: string;
}

export interface Comment {
  id: string;
  paymentId: string;
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
export interface CreatePaymentInput {
  direction: 'IN' | 'OUT';
  /**
   * Iteration 6.18.1 widens the union to include `'RECURRING'`. The schedule
   * itself is created by a separate POST /payments/:id/schedule call (see
   * the two-step create flow in `<PaymentFormDialog>`); the request body
   * therefore still carries no `schedule` payload.
   */
  type: 'ONE_TIME' | 'RECURRING';
  amountCents: number;
  currency: string;
  occurredAt: string;
  categoryId: string;
  note?: string;
  attributions: AttributionScope[];
  schedule?: never;
  plan?: never;
}

// ── Schedule wire types (Phase 6 · Iteration 6.18.1) ────────────────────────

/**
 * Body shape for POST / PUT /payments/:paymentId/schedule.
 *
 * Exactly one of `cron` / `everyMs` must be set — the API does the
 * authoritative cross-field check; client-side validation rejects the
 * obvious "both" / "neither" cases before the round trip.
 *
 * `everyMs` minimum is 60_000 (1 minute) in production. Tests / staging
 * may relax it via the `PAYMENT_SCHEDULE_MIN_INTERVAL_MS` env knob.
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
  paymentId: string;
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
 * Edit-eligibility predicate consumed by `<PaymentDetailHeader>` and
 * `<PaymentRow>` (Phase 6 · Iteration 6.18.1.2).
 *
 * The form supports `ONE_TIME` and `RECURRING` (parent) types; everything
 * else (`INSTALLMENT` / `LOAN` / `MORTGAGE` / `LIMITED_PERIOD`) is still
 * read-only until the dedicated forms ship. Server-generated occurrences
 * (`parentPaymentId !== null`) stay non-editable per the
 * `PAYMENT_CANNOT_EDIT_GENERATED_OCCURRENCE` rule; per-child overrides
 * land in 6.18.1.6.
 *
 * Authorisation (creator / co-owner) is layered separately by the caller —
 * this helper only reports whether the form *can technically* edit the
 * payment.
 */
export type CannotEditReason = 'generatedOccurrence' | 'unsupportedType';

export function canEditPayment(payment: Pick<PaymentSummary, 'parentPaymentId' | 'type'>): boolean {
  if (payment.parentPaymentId !== null) return false;
  return payment.type === 'ONE_TIME' || payment.type === 'RECURRING';
}

export function cannotEditReason(
  payment: Pick<PaymentSummary, 'parentPaymentId' | 'type'>,
): CannotEditReason | null {
  if (payment.parentPaymentId !== null) return 'generatedOccurrence';
  if (payment.type !== 'ONE_TIME' && payment.type !== 'RECURRING') return 'unsupportedType';
  return null;
}

export interface UpdatePaymentInput {
  direction?: 'IN' | 'OUT';
  type?: 'ONE_TIME' | 'RECURRING';
  amountCents?: number;
  currency?: string;
  occurredAt?: string;
  categoryId?: string;
  note?: string | null;
  attributions?: AttributionScope[];
}

export interface ListPaymentsParams {
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
  parentPaymentId?: string;
  /** Iteration 6.18.1.3 — `true` parents only, `false` occurrences only. */
  withParent?: boolean;
}

/** Query knobs accepted by `usePayments().listOccurrences()`. */
export interface ListOccurrencesParams {
  cursor?: string;
  limit?: number;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
}

export interface AttributionChangeResult {
  deletedAttributions: number;
  addedAttributions: number;
  paymentDeleted: boolean;
  payment: PaymentSummary | null;
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
