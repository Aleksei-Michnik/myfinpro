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
  type: 'ONE_TIME';
  amountCents: number;
  currency: string;
  occurredAt: string;
  categoryId: string;
  note?: string;
  attributions: AttributionScope[];
  schedule?: never;
  plan?: never;
}

export interface UpdatePaymentInput {
  direction?: 'IN' | 'OUT';
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
