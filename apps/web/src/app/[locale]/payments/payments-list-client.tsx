'use client';

// Phase 6 · Iteration 6.16 — orchestrator for /payments.
// Phase 6 · Iteration 6.16.1 — filter state lives in the URL.
// Phase 6 · Iteration 6.16.2 — full state-machine integration. The
// orchestrator now:
//   - Owns the container-scope `useAsyncOperation` for the filter fetch.
//   - Maintains `committedFilters` (drives every visual control) separate
//     from `pendingFilters` (the in-flight intent the user is selecting).
//   - Renders <LoadingOverlay> over the content area while loading.
//   - Cascades `disabled` to every filter control during the in-flight op.
//   - Writes the URL ONLY on commit — eliminating the pre-commit visual
//     drift (the bug where Income button rendered green/active while the
//     rows were still expense rows).
//   - Opens <RetryReturnDialog> on failure, with auto-retry countdown.
//   - Resets to `defaultFilters(scope)` on initial-mount Return.

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PaymentsList, type PaymentsListData } from '@/components/payment/PaymentsList';
import { PaymentsScopeTabs } from '@/components/payment/PaymentsScopeTabs';
import { StarredFilterToggle } from '@/components/payment/StarredFilterToggle';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useGroups } from '@/lib/group/group-context';
import {
  clearFilters,
  defaultFilters,
  filtersFromQuery,
  filtersToQuery,
  isFiltersDirty,
  type PaymentFilters,
} from '@/lib/payment/filters';
import { usePayments } from '@/lib/payment/payment-context';
import type { PaymentListResponse } from '@/lib/payment/types';
import { useAsyncOperation } from '@/lib/ui';

const PAGE_LIMIT = 20;

function paramsFor(filters: PaymentFilters, cursor?: string) {
  return {
    scope: filters.scope === 'all' ? undefined : filters.scope,
    direction: filters.direction,
    categoryId: filters.categoryId,
    from: filters.from,
    to: filters.to,
    starred: filters.starred ? true : undefined,
    search: filters.search,
    sort: filters.sort,
    limit: PAGE_LIMIT,
    cursor,
  };
}

export function PaymentsListClient() {
  const t = useTranslations('payments.page');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groups } = useGroups();
  const { fetchList } = usePayments();

  // Initial filters from the URL — this is the *committed* state on mount.
  // The URL is only the source-of-truth on initial mount; subsequent updates
  // flow through committedFilters. We capture the initial value once.
  const initialFiltersRef = useRef<PaymentFilters | null>(null);
  if (initialFiltersRef.current === null) {
    initialFiltersRef.current = filtersFromQuery(searchParams);
  }
  const initialFilters = initialFiltersRef.current;

  const [committedFilters, setCommittedFilters] = useState<PaymentFilters>(initialFilters);
  const [data, setData] = useState<PaymentsListData>({
    rows: [],
    cursor: null,
    hasMore: false,
  });
  const [hasCommittedOnce, setHasCommittedOnce] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);

  // Pending filter intent — set when a fetch is initiated; cleared on commit.
  const pendingFiltersRef = useRef<PaymentFilters | null>(null);
  // Track whether the most-recent failed op was the initial mount, so a
  // user-initiated Return resets to default filters.
  const failedOnInitialMountRef = useRef(true);
  // Stable refs for router/pathname/fetchList so commit() identity is stable.
  const fetchListRef = useRef(fetchList);
  fetchListRef.current = fetchList;
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const op = useAsyncOperation<PaymentListResponse>({
    scope: 'container',
    id: 'payments-page-fetch',
  });

  // Stable refs for op methods so commit() doesn't need to depend on `op`.
  const opRef = useRef(op);
  opRef.current = op;

  const dirty = isFiltersDirty(committedFilters);
  const scope = committedFilters.scope ?? 'all';

  // Validate group scope membership before issuing API calls.
  const noAccess = useMemo(() => {
    if (typeof scope !== 'string' || !scope.startsWith('group:')) return false;
    const groupId = scope.slice('group:'.length);
    return !groups.some((g) => g.id === groupId);
  }, [scope, groups]);

  // ── Commit pipeline (stable identity via refs) ────────────────────────
  // Run a fetch with `intent`. On success, commit `intent` as the new
  // committedFilters AND write the URL — these two are atomic. On failure,
  // open the recovery dialog without touching either.
  const commit = useCallback(async (intent: PaymentFilters) => {
    pendingFiltersRef.current = intent;
    setShowErrorDialog(false);
    const result = await opRef.current.run((signal) =>
      fetchListRef.current(paramsFor(intent), signal),
    );
    if (result === undefined) {
      setShowErrorDialog(true);
      return;
    }
    setCommittedFilters(intent);
    setData({ rows: result.data, cursor: result.nextCursor, hasMore: result.hasMore });
    setHasCommittedOnce(true);
    failedOnInitialMountRef.current = false;
    pendingFiltersRef.current = null;
    const qs = filtersToQuery(intent).toString();
    routerRef.current.replace(qs ? `${pathnameRef.current}?${qs}` : pathnameRef.current);
  }, []);

  // ── Initial mount — runs exactly once via a ref guard ─────────────────
  const didMountFetchRef = useRef(false);
  useEffect(() => {
    if (didMountFetchRef.current) return;
    if (noAccess) return;
    didMountFetchRef.current = true;
    void commit(initialFilters);
  }, [commit, initialFilters, noAccess]);

  // ── Filter change handlers — all funnel into commit() ─────────────────
  const handleFiltersChange = useCallback(
    (next: PaymentFilters) => {
      void commit(next);
    },
    [commit],
  );

  const handleScopeChange = useCallback(
    (nextScope: string) => {
      void commit({ ...defaultFilters(nextScope), sort: committedFilters.sort });
    },
    [commit, committedFilters.sort],
  );

  const setStarred = useCallback(
    (starred: boolean) => void commit({ ...committedFilters, starred: starred || undefined }),
    [commit, committedFilters],
  );

  const handleClear = useCallback(
    () => void commit(clearFilters(committedFilters.scope)),
    [commit, committedFilters.scope],
  );

  // ── Dialog handlers ───────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    setShowErrorDialog(false);
    // Re-issue the last attempted intent. We re-run via commit() with the
    // pending intent so the success path commits + writes URL identically
    // to a fresh user click.
    const intent = pendingFiltersRef.current ?? committedFilters;
    void commit(intent);
  }, [commit, committedFilters]);

  const handleReturn = useCallback(() => {
    setShowErrorDialog(false);
    opRef.current.cancel();
    pendingFiltersRef.current = null;
    if (!hasCommittedOnce && failedOnInitialMountRef.current) {
      // Initial-mount failure — reset to clean defaults and rewrite URL.
      const cleaned = defaultFilters(committedFilters.scope);
      setCommittedFilters(cleaned);
      setData({ rows: [], cursor: null, hasMore: false });
      setHasCommittedOnce(true);
      const qs = filtersToQuery(cleaned).toString();
      routerRef.current.replace(qs ? `${pathnameRef.current}?${qs}` : pathnameRef.current);
    }
  }, [hasCommittedOnce, committedFilters.scope]);

  const handleAppendData = useCallback((next: PaymentsListData) => {
    setData(next);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  const orchestratorLoading = op.isLoading;
  const errorReason = op.error?.reason ?? 'unknown';
  const errorStatus = op.error?.httpStatus;

  return (
    <main className="container mx-auto space-y-4 px-4 py-6" data-testid="payments-page">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </header>

      <PaymentsScopeTabs
        current={scope}
        groups={groups}
        onChange={handleScopeChange}
        disabled={orchestratorLoading}
      />

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
            <StarredFilterToggle
              starred={!!committedFilters.starred}
              onChange={setStarred}
              disabled={orchestratorLoading}
            />
            {dirty && (
              <button
                type="button"
                onClick={handleClear}
                disabled={orchestratorLoading}
                aria-disabled={orchestratorLoading || undefined}
                data-testid="payments-clear-filters"
                className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t('clearFilters')}
              </button>
            )}
          </div>
          <div className="relative" data-testid="payments-page-content">
            <PaymentsList
              filters={committedFilters}
              onFiltersChange={handleFiltersChange}
              lockScope
              showFilters
              showControls
              showStar
              data={data}
              loading={orchestratorLoading}
              error={op.error?.message ?? null}
              onAppendData={handleAppendData}
            />
            <LoadingOverlay active={orchestratorLoading} />
          </div>
        </>
      )}

      <RetryReturnDialog
        open={showErrorDialog}
        reason={errorReason}
        httpStatus={errorStatus}
        onRetry={handleRetry}
        onReturn={handleReturn}
      />
    </main>
  );
}
