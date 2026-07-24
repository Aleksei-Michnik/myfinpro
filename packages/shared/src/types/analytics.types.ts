/**
 * Analytics types — Phase 9 (design: docs/phase-9-analytics-design.md).
 *
 * The configurable aggregation engine: the caller composes 0–2 dimensions
 * plus filters; every response row is additionally keyed by currency
 * (per-currency aggregation, no FX conversion — design §2.4).
 */

import type {
  AttributionScope,
  AttributionScopeType,
  TransactionDirection,
} from './transaction.types';

/** Dimensions the engine can group by (design §2.5 — closed allowlist). */
export const ANALYTICS_DIMENSIONS = [
  'category',
  'merchant',
  'product',
  'member',
  'group',
  'scope',
  'period',
] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

/** Period bucket sizes for the `period` dimension. */
export const ANALYTICS_GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];

/** Sort fields: metric sorts or the dimension key itself. */
export const ANALYTICS_SORT_FIELDS = ['spend', 'count', 'key'] as const;
export type AnalyticsSortField = (typeof ANALYTICS_SORT_FIELDS)[number];

/** At most two dimensions per query — keeps tables and charts readable. */
export const ANALYTICS_MAX_DIMENSIONS = 2;
/** Hard cap on result groups per query (offset + limit may not exceed it). */
export const ANALYTICS_MAX_GROUPS = 500;

export interface AnalyticsQueryFilters {
  /** Defaults to 'OUT' — this is purchase analytics (design §2.2). */
  direction?: TransactionDirection;
  /** Narrow to specific attribution scopes; default = everything accessible. */
  scopes?: AttributionScope[];
  /** ISO 8601 inclusive lower bound on the transaction date. */
  dateFrom?: string;
  /** ISO 8601 exclusive upper bound on the transaction date. */
  dateTo?: string;
  /** Effective category (item category with header fallback — design §2.1). */
  categoryIds?: string[];
  merchantIds?: string[];
  /** Item-only field: selects item rows exclusively (design §2.1). */
  productIds?: string[];
  /** Transaction creators (design §2.5 "member"). */
  memberIds?: string[];
  currencies?: string[];
}

export interface AnalyticsQuerySort {
  by: AnalyticsSortField;
  dir: 'asc' | 'desc';
}

/** The engine input — also the JSON persisted by saved views (9.2). */
export interface AnalyticsQuery {
  dimensions: AnalyticsDimension[];
  /** Required iff `dimensions` contains 'period'; forbidden otherwise. */
  granularity?: AnalyticsGranularity;
  filters?: AnalyticsQueryFilters;
  /** Default: spend desc. */
  sort?: AnalyticsQuerySort;
  limit?: number;
  cursor?: string;
}

/** An id + display-name pair; both null for the "no value" bucket. */
export interface AnalyticsKeyRef {
  id: string | null;
  name: string | null;
}

/** Key of a `scope` dimension bucket. */
export interface AnalyticsScopeKey {
  scopeType: AttributionScopeType;
  /** Present when scopeType = 'group'. */
  group?: AnalyticsKeyRef;
}

export interface AnalyticsResultKeys {
  category?: AnalyticsKeyRef;
  merchant?: AnalyticsKeyRef;
  product?: AnalyticsKeyRef;
  member?: AnalyticsKeyRef;
  group?: AnalyticsKeyRef;
  scope?: AnalyticsScopeKey;
  /** '2026-06-15' | '2026-W24' | '2026-06' | '2026-Q2' | '2026' per granularity. */
  period?: string;
}

/** One aggregate bucket. Rows never mix currencies (design §2.4). */
export interface AnalyticsResultRow {
  keys: AnalyticsResultKeys;
  currency: string;
  spendCents: number;
  /** Distinct transactions contributing to the bucket. */
  transactionCount: number;
  /** Receipt-item rows contributing (0 = header-only spend). */
  itemCount: number;
}
