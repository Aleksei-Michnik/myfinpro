'use client';

// Phase 6 · Iteration 6.16 — orchestrator for /payments.
// Phase 6 · Iteration 6.16.1 — filter state lives in the URL. We parse
// `?scope=...&starred=...&direction=...&from=...&to=...&q=...&categoryId=...&sort=...`
// on every render via `filtersFromQuery()`, feed `<PaymentsList>` and
// `<PaymentsFilters>` controlled, and write back via `router.replace` on
// every change. A "Clear filters" button shows when any non-default,
// non-scope filter is set.

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { PaymentsList } from '@/components/payment/PaymentsList';
import { PaymentsScopeTabs } from '@/components/payment/PaymentsScopeTabs';
import { StarredFilterToggle } from '@/components/payment/StarredFilterToggle';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useGroups } from '@/lib/group/group-context';
import {
  clearFilters,
  filtersFromQuery,
  filtersToQuery,
  isFiltersDirty,
  type PaymentFilters,
} from '@/lib/payment/filters';

export function PaymentsListClient() {
  const t = useTranslations('payments.page');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groups } = useGroups();

  // Parse the URL on every render — single source of truth.
  const filters = useMemo(() => filtersFromQuery(searchParams), [searchParams]);
  const dirty = isFiltersDirty(filters);
  const scope = filters.scope ?? 'all';

  // Validate group scope membership before issuing API calls.
  const noAccess = useMemo(() => {
    if (typeof scope !== 'string' || !scope.startsWith('group:')) return false;
    const groupId = scope.slice('group:'.length);
    return !groups.some((g) => g.id === groupId);
  }, [scope, groups]);

  const writeFilters = useCallback(
    (next: PaymentFilters) => {
      const qs = filtersToQuery(next).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router],
  );

  const setStarred = useCallback(
    (starred: boolean) => writeFilters({ ...filters, starred: starred || undefined }),
    [filters, writeFilters],
  );

  const handleClear = useCallback(
    () => writeFilters(clearFilters(filters.scope)),
    [filters.scope, writeFilters],
  );

  return (
    <main className="container mx-auto space-y-4 px-4 py-6" data-testid="payments-page">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </header>

      <PaymentsScopeTabs current={scope} groups={groups} />

      {noAccess ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
          data-testid="payments-page-no-access"
          role="alert"
        >
          <p>{t('scopeTabs.noAccess')}</p>
          <Link
            href="/dashboard"
            className="mt-2 inline-block text-sm font-medium text-primary-600 hover:underline"
            data-testid="payments-page-back-to-dashboard"
          >
            {t('scopeTabs.backToDashboard')}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-end gap-2">
            <StarredFilterToggle starred={!!filters.starred} onChange={setStarred} />
            {dirty && (
              <button
                type="button"
                onClick={handleClear}
                data-testid="payments-clear-filters"
                className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t('clearFilters')}
              </button>
            )}
          </div>
          <PaymentsList
            filters={filters}
            onFiltersChange={writeFilters}
            lockScope
            showFilters
            showControls
            showStar
          />
        </>
      )}
    </main>
  );
}
