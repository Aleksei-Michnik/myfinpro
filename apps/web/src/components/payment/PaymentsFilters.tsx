'use client';

// Phase 6 · Iteration 6.12 — toolbar of filter controls used by <PaymentsList>.
//
// Self-contained: parent owns the value, this component only emits `onChange`
// with a fresh object on every interaction. The category dropdown can be
// either parent-fed (via the `categories` prop) or self-fetched on mount /
// direction change. Search input is debounced 300 ms inline so the parent
// only refetches when the user pauses typing.

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useGroups } from '@/lib/group/group-context';
import { usePayments } from '@/lib/payment/payment-context';
import type { CategoryDto } from '@/lib/payment/types';

export type PaymentsFiltersSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export interface PaymentsFiltersValue {
  /** undefined = both directions */
  direction?: 'IN' | 'OUT';
  /** 'all' | 'personal' | 'group:<id>' */
  scope?: 'all' | 'personal' | string;
  starred?: boolean;
  categoryId?: string;
  search?: string;
  /** ISO YYYY-MM-DD (or empty) */
  from?: string;
  to?: string;
  sort: PaymentsFiltersSort;
}

export interface PaymentsFiltersProps {
  value: PaymentsFiltersValue;
  onChange(next: PaymentsFiltersValue): void;
  /**
   * Hide certain controls when the parent forces them. E.g. when scope is
   * locked by the page (group-tab), we hide the scope dropdown.
   */
  hide?: { scope?: boolean };
  /**
   * Optional category list. When `null` or omitted, the component fetches
   * its own and re-fetches whenever `value.direction` changes.
   */
  categories?: CategoryDto[] | null;
}

/** Group categories by ownership: System → Personal → per-group. */
function groupCategories(cats: CategoryDto[]): {
  system: CategoryDto[];
  personal: CategoryDto[];
  groups: Map<string, CategoryDto[]>;
} {
  const system: CategoryDto[] = [];
  const personal: CategoryDto[] = [];
  const groups = new Map<string, CategoryDto[]>();
  for (const c of cats) {
    if (c.ownerType === 'system') system.push(c);
    else if (c.ownerType === 'user') personal.push(c);
    else if (c.ownerType === 'group') {
      const key = c.ownerId ?? 'unknown';
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
  }
  return { system, personal, groups };
}

export function PaymentsFilters({
  value,
  onChange,
  hide,
  categories: categoriesProp,
}: PaymentsFiltersProps) {
  const t = useTranslations('payments.filters');
  const { groups } = useGroups();
  const { listCategories } = usePayments();

  // Local search state so we can debounce 300 ms before bubbling up.
  const [searchLocal, setSearchLocal] = useState<string>(value.search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedSearchRef = useRef<string>(value.search ?? '');

  // Self-fetched categories when parent didn't pass any.
  const [fetched, setFetched] = useState<CategoryDto[] | null>(null);
  const categories = categoriesProp ?? fetched;

  // Update local search when external value changes from outside (e.g. reset).
  useEffect(() => {
    const ext = value.search ?? '';
    if (ext !== lastEmittedSearchRef.current) {
      setSearchLocal(ext);
      lastEmittedSearchRef.current = ext;
    }
  }, [value.search]);

  // Debounce: emit onChange 300 ms after user stops typing.
  useEffect(() => {
    if ((searchLocal ?? '') === lastEmittedSearchRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastEmittedSearchRef.current = searchLocal;
      onChange({ ...value, search: searchLocal || undefined });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Note: `value` / `onChange` deliberately omitted — the effect's job is
    // to debounce the *local* searchLocal state. The captured closure reads
    // the latest via re-renders.
  }, [searchLocal]);

  // Self-fetch categories when not provided and on direction change.
  useEffect(() => {
    if (categoriesProp !== undefined && categoriesProp !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await listCategories(
          value.direction ? { direction: value.direction } : undefined,
        );
        if (!cancelled) setFetched(result);
      } catch {
        if (!cancelled) setFetched([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoriesProp, listCategories, value.direction]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const setDirection = (direction: 'IN' | 'OUT' | undefined) => onChange({ ...value, direction });

  const setScope = (scope: 'all' | 'personal' | string) => onChange({ ...value, scope });

  const setStarred = (starred: boolean) => onChange({ ...value, starred });

  const setCategoryId = (categoryId: string) =>
    onChange({ ...value, categoryId: categoryId || undefined });

  const setFrom = (from: string) => onChange({ ...value, from: from || undefined });
  const setTo = (to: string) => onChange({ ...value, to: to || undefined });

  const setSort = (sort: PaymentsFiltersSort) => onChange({ ...value, sort });

  // ── Render ────────────────────────────────────────────────────────────────

  const direction = value.direction;
  const scope = value.scope ?? 'all';
  const starred = !!value.starred;

  const grouped = categories ? groupCategories(categories) : null;

  return (
    <div
      className="flex flex-wrap items-end gap-2"
      data-testid="payments-filters"
      role="group"
      aria-label="Payments filters"
    >
      {/* Direction tri-toggle */}
      <div
        className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600"
        role="group"
        aria-label={t('all')}
      >
        <button
          type="button"
          onClick={() => setDirection(undefined)}
          data-testid="filter-direction-all"
          aria-pressed={direction === undefined}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            direction === undefined
              ? 'bg-primary-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {t('all')}
        </button>
        <button
          type="button"
          onClick={() => setDirection('IN')}
          data-testid="filter-direction-in"
          aria-pressed={direction === 'IN'}
          className={`border-l border-gray-300 px-3 py-1.5 text-sm font-medium transition-colors dark:border-gray-600 ${
            direction === 'IN'
              ? 'bg-green-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {t('in')}
        </button>
        <button
          type="button"
          onClick={() => setDirection('OUT')}
          data-testid="filter-direction-out"
          aria-pressed={direction === 'OUT'}
          className={`border-l border-gray-300 px-3 py-1.5 text-sm font-medium transition-colors dark:border-gray-600 ${
            direction === 'OUT'
              ? 'bg-red-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {t('out')}
        </button>
      </div>

      {/* Scope */}
      {!hide?.scope && (
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span className="sr-only">{t('scopeAll')}</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            data-testid="filter-scope"
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">{t('scopeAll')}</option>
            <option value="personal">{t('scopePersonal')}</option>
            {groups.map((g) => (
              <option key={g.id} value={`group:${g.id}`}>
                {t('scopeGroup', { name: g.name })}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Starred */}
      <label className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
        <input
          type="checkbox"
          checked={starred}
          onChange={(e) => setStarred(e.target.checked)}
          data-testid="filter-starred"
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span>{t('starred')}</span>
      </label>

      {/* Search */}
      <label className="flex flex-col text-xs">
        <span className="sr-only">{t('search')}</span>
        <input
          type="search"
          value={searchLocal}
          onChange={(e) => setSearchLocal(e.target.value)}
          placeholder={t('search')}
          data-testid="filter-search"
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      {/* From / To */}
      <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
        <span>{t('from')}</span>
        <input
          type="date"
          value={value.from ?? ''}
          onChange={(e) => setFrom(e.target.value)}
          data-testid="filter-from"
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
        <span>{t('to')}</span>
        <input
          type="date"
          value={value.to ?? ''}
          onChange={(e) => setTo(e.target.value)}
          data-testid="filter-to"
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      {/* Category */}
      <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
        <span className="sr-only">{t('category')}</span>
        <select
          value={value.categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value)}
          data-testid="filter-category"
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">{t('anyCategory')}</option>
          {grouped && grouped.system.length > 0 && (
            <optgroup label={t('categoryGroupSystem')}>
              {grouped.system.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          {grouped && grouped.personal.length > 0 && (
            <optgroup label={t('categoryGroupPersonal')}>
              {grouped.personal.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          {grouped &&
            Array.from(grouped.groups.entries()).map(([groupId, list]) => {
              const g = groups.find((x) => x.id === groupId);
              const label = g ? `${t('categoryGroupGroup')}: ${g.name}` : t('categoryGroupGroup');
              return (
                <optgroup key={groupId} label={label}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
        </select>
      </label>

      {/* Sort */}
      <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
        <span className="sr-only">{t('sort')}</span>
        <select
          value={value.sort}
          onChange={(e) => setSort(e.target.value as PaymentsFiltersSort)}
          data-testid="filter-sort"
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="date_desc">{t('sortDateDesc')}</option>
          <option value="date_asc">{t('sortDateAsc')}</option>
          <option value="amount_desc">{t('sortAmountDesc')}</option>
          <option value="amount_asc">{t('sortAmountAsc')}</option>
        </select>
      </label>
    </div>
  );
}
