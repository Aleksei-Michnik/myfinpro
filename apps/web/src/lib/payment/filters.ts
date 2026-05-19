// Phase 6 · Iteration 6.16.1 — single source of truth for the URL ↔ filter
// mapping used by `<PaymentsList>` + `<PaymentsFilters>` on /payments.
//
// Re-uses the existing `PaymentsFiltersValue` shape (defined alongside the
// component) so that dashboard widgets like <RecentActivity> /
// <StarredPayments> can keep using `initialFilters` unchanged. This module
// only adds:
//   - `defaultFilters(scope)` — canonical empty state.
//   - `filtersToQuery(filters)` — emit URLSearchParams for the page URL.
//   - `filtersFromQuery(searchParams)` — parse a `URLSearchParams` (or
//     `ReadonlyURLSearchParams` from Next.js) into a fresh filter object.
//   - `isFiltersDirty(filters)` — true when any non-default, non-scope
//     filter is set (drives "Clear filters" button visibility).
//   - `clearFilters(scope)` — alias for `defaultFilters(scope)`.

import type { PaymentsFiltersValue } from '@/components/payment/PaymentsFilters';

/**
 * Iteration 6.18.1.3 — partition the visible payments by parent/child.
 *
 * - `'all'` (default): both parents and occurrences. No API constraint.
 * - `'parents'`: parents only — `withParent=true` on the API.
 * - `'occurrences'`: generated children only — `withParent=false`.
 *
 * The UI control for this filter ships in iteration 6.18.3; right now we
 * only thread the field through the URL so deep-links stay stable.
 */
export type ChildScope = 'all' | 'parents' | 'occurrences';

/**
 * Re-export under a name closer to how it's discussed in the design doc,
 * extended with the iteration 6.18.1.3 `childScope` partition.
 */
export type PaymentFilters = PaymentsFiltersValue & {
  /** Default `'all'`. */
  childScope?: ChildScope;
};

/** Scope filter shape — `'all'` means no API constraint. */
export type FiltersScope = 'all' | 'personal' | string;

const SORT_VALUES = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const;
type Sort = (typeof SORT_VALUES)[number];

const DIRECTION_VALUES = ['IN', 'OUT'] as const;
type Direction = (typeof DIRECTION_VALUES)[number];

function isSort(v: string | null | undefined): v is Sort {
  return !!v && (SORT_VALUES as readonly string[]).includes(v);
}

function isDirection(v: string | null | undefined): v is Direction {
  return !!v && (DIRECTION_VALUES as readonly string[]).includes(v);
}

const CHILD_SCOPE_VALUES = ['all', 'parents', 'occurrences'] as const;

function isChildScope(v: string | null | undefined): v is ChildScope {
  return !!v && (CHILD_SCOPE_VALUES as readonly string[]).includes(v);
}

/** Canonical empty filter state. Scope defaults to `'all'`. */
export function defaultFilters(scope: FiltersScope = 'all'): PaymentFilters {
  return { scope, sort: 'date_desc' };
}

/**
 * Serialise a filter object into URL search params. Default-valued keys are
 * dropped (e.g. `scope=all`, `sort=date_desc`, falsy `starred`) so the URL
 * stays clean for the common case.
 */
export function filtersToQuery(filters: PaymentFilters): URLSearchParams {
  const params = new URLSearchParams();
  const scope = filters.scope ?? 'all';
  if (scope !== 'all') params.set('scope', scope);
  if (filters.starred) params.set('starred', '1');
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.search) params.set('q', filters.search);
  if (filters.sort && filters.sort !== 'date_desc') params.set('sort', filters.sort);
  if (filters.childScope && filters.childScope !== 'all') {
    params.set('childScope', filters.childScope);
  }
  return params;
}

/** Minimal interface satisfied by both `URLSearchParams` and Next's `ReadonlyURLSearchParams`. */
export interface FilterQueryReader {
  get(name: string): string | null;
}

/**
 * Parse URL search params into a fresh `PaymentFilters`. Invalid values
 * (e.g. `direction=foo`, `sort=bogus`) are ignored — defaults take over.
 */
export function filtersFromQuery(searchParams: FilterQueryReader): PaymentFilters {
  const rawScope = searchParams.get('scope');
  let scope: FiltersScope = 'all';
  if (rawScope === 'personal') scope = 'personal';
  else if (rawScope && rawScope.startsWith('group:')) scope = rawScope;

  const rawDirection = searchParams.get('direction');
  const rawSort = searchParams.get('sort');
  const q = searchParams.get('q');
  const rawChildScope = searchParams.get('childScope');

  return {
    scope,
    starred: searchParams.get('starred') === '1' ? true : undefined,
    direction: isDirection(rawDirection) ? rawDirection : undefined,
    categoryId: searchParams.get('categoryId') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    search: q ?? undefined,
    sort: isSort(rawSort) ? rawSort : 'date_desc',
    childScope: isChildScope(rawChildScope) ? rawChildScope : undefined,
  };
}

/**
 * "Dirty" = any non-scope filter is set away from its default. Used to
 * decide whether the page should render a "Clear filters" affordance.
 */
export function isFiltersDirty(filters: PaymentFilters): boolean {
  return Boolean(
    filters.starred ||
    filters.direction ||
    filters.categoryId ||
    filters.from ||
    filters.to ||
    (filters.search && filters.search.length > 0) ||
    (filters.sort && filters.sort !== 'date_desc') ||
    (filters.childScope && filters.childScope !== 'all'),
  );
}

/** Reset all filters but preserve the active scope tab. */
export function clearFilters(scope: FiltersScope = 'all'): PaymentFilters {
  return defaultFilters(scope);
}
