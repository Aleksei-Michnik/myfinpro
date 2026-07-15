// Phase 6 · Iteration 6.16.1 — single source of truth for the URL ↔ filter
// mapping used by `<TransactionsList>` + `<TransactionsFilters>` on /transactions.
//
// Re-uses the existing `TransactionsFiltersValue` shape (defined alongside the
// component) so that dashboard widgets like <RecentActivity> /
// <StarredTransactions> can keep using `initialFilters` unchanged. This module
// only adds:
//   - `defaultFilters(scope)` — canonical empty state.
//   - `filtersToQuery(filters)` — emit URLSearchParams for the page URL.
//   - `filtersFromQuery(searchParams)` — parse a `URLSearchParams` (or
//     `ReadonlyURLSearchParams` from Next.js) into a fresh filter object.
//   - `isFiltersDirty(filters)` — true when any non-default, non-scope
//     filter is set (drives "Clear filters" button visibility).
//   - `clearFilters(scope)` — alias for `defaultFilters(scope)`.

import type { TransactionsFiltersValue } from '@/components/transaction/TransactionsFilters';

/**
 * Iteration 6.18.1.3 — partition the visible transactions by parent/child.
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
export type TransactionFilters = TransactionsFiltersValue & {
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
export function defaultFilters(scope: FiltersScope = 'all'): TransactionFilters {
  return { scope, sort: 'date_desc' };
}

/**
 * Serialise a filter object into URL search params. Default-valued keys are
 * dropped (e.g. `scope=all`, `sort=date_desc`, falsy `starred`) so the URL
 * stays clean for the common case.
 */
export function filtersToQuery(filters: TransactionFilters): URLSearchParams {
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
 * Parse URL search params into a fresh `TransactionFilters`. Invalid values
 * (e.g. `direction=foo`, `sort=bogus`) are ignored — defaults take over.
 */
export function filtersFromQuery(searchParams: FilterQueryReader): TransactionFilters {
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
export function isFiltersDirty(filters: TransactionFilters): boolean {
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
export function clearFilters(scope: FiltersScope = 'all'): TransactionFilters {
  return defaultFilters(scope);
}

// ── Realtime support (Phase 6 · Iteration 6.18.1.4.1) ───────────────────────

/**
 * Minimal transaction shape required to evaluate filter membership. Mirrors the
 * client-facing `TransactionSummary` but kept structural so realtime event payloads
 * (which already match this shape) can be tested without a cast.
 */
export interface FilterableTransaction {
  direction: 'IN' | 'OUT';
  category: { id: string };
  occurredAt: string;
  starredByMe: boolean;
  note?: string | null;
  parentTransactionId?: string | null;
  attributions: Array<{
    scope: 'personal' | 'group';
    userId?: string | null;
    groupId?: string | null;
  }>;
}

/**
 * Decide whether a transaction should be visible under the active filters. Used
 * by realtime subscribers (`transaction.created` / `transaction.updated`) to decide
 * whether to inject the row into the local list before the user issues a
 * fresh fetch. Server-side authoritative filtering still happens on the next
 * pagination call; this is a best-effort optimistic predicate so the user
 * sees their own (and collaborators') changes without a refresh.
 *
 * Caller must already have applied any cross-cutting visibility filter (the
 * SSE stream only delivers events for transactions the user can see, so we don't
 * re-check membership here).
 */
export function transactionMatchesFilters(
  p: FilterableTransaction,
  f: TransactionFilters,
): boolean {
  // Scope.
  const scope = f.scope ?? 'all';
  if (scope === 'personal') {
    if (!p.attributions.some((a) => a.scope === 'personal')) return false;
  } else if (typeof scope === 'string' && scope.startsWith('group:')) {
    const gid = scope.slice('group:'.length);
    if (!p.attributions.some((a) => a.scope === 'group' && a.groupId === gid)) return false;
  }

  // Child scope.
  const childScope = f.childScope ?? 'all';
  if (childScope === 'parents' && p.parentTransactionId) return false;
  if (childScope === 'occurrences' && !p.parentTransactionId) return false;

  if (f.direction && p.direction !== f.direction) return false;
  if (f.categoryId && p.category.id !== f.categoryId) return false;
  if (f.starred && !p.starredByMe) return false;

  if (f.from) {
    const fromMs = new Date(f.from).getTime();
    if (Number.isFinite(fromMs) && new Date(p.occurredAt).getTime() < fromMs) return false;
  }
  if (f.to) {
    const toMs = new Date(f.to).getTime();
    if (Number.isFinite(toMs) && new Date(p.occurredAt).getTime() >= toMs) return false;
  }

  if (f.search) {
    const needle = f.search.toLowerCase();
    if (!(p.note ?? '').toLowerCase().includes(needle)) return false;
  }

  return true;
}
