'use client';

// Phase 6 · Iteration 6.12 — top-level reusable payments list.
// Phase 6 · Iteration 6.16.1 — fully controlled (or uncontrolled) by the
// parent via the `filters` / `onFiltersChange` props.
// Phase 6 · Iteration 6.16.2 — fully migrated to `useAsyncOperation`. Two
// modes:
//
//   1. Self-fetch (the dashboard widgets — `data` prop omitted): the list
//      owns both the first-page fetch and "Load more" pagination through
//      its own container-scope ops. Filter changes trigger a reset fetch.
//
//   2. Orchestrator-owned (`data` prop provided — used by /payments): the
//      orchestrator owns the first-page fetch and recovery UI. The list
//      reads rows from `data`, and any "Load more" appends are reported
//      back via `onAppendData`. The list still owns the load-more op.
//
// Both modes use the same useAsyncOperation primitive — no hand-rolled
// `setLoading(true)` / inline error state remains.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DeletePaymentDialog } from './DeletePaymentDialog';
import { PaymentFormDialog } from './PaymentFormDialog';
import { PaymentRow } from './PaymentRow';
import { PaymentsFilters, type PaymentsFiltersValue } from './PaymentsFilters';
import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/InlineLoader';
import { useRouter } from '@/i18n/navigation';
import { defaultFilters, paymentMatchesFilters } from '@/lib/payment/filters';
import { usePayments } from '@/lib/payment/payment-context';
import type {
  AttributionChangeResult,
  CategoryDto,
  ListPaymentsParams,
  PaymentListResponse,
  PaymentSummary,
} from '@/lib/payment/types';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useAsyncOperation } from '@/lib/ui';

export interface PaymentsListData {
  rows: PaymentSummary[];
  cursor: string | null;
  hasMore: boolean;
}

export interface PaymentsListProps {
  filters?: PaymentsFiltersValue;
  onFiltersChange?(next: PaymentsFiltersValue): void;
  /** Hide the scope dropdown — used by /payments where a tab strip owns scope. */
  lockScope?: boolean;
  /** Toggle the filter toolbar entirely. Default true. */
  showFilters?: boolean;
  /** Per-row controls (edit / delete). Default true. */
  showControls?: boolean;
  /** Per-row star toggle. Default true. */
  showStar?: boolean;
  limit?: number;
  emptyState?: ReactNode;
  onPaymentClick?(id: string): void;
  onPaymentEdit?(id: string): void;
  /** Pre-fetched categories shared across multiple lists. */
  categories?: CategoryDto[] | null;
  /** When true, the toolbar doesn't render the inline "Add payment" button. */
  disableInternalAdd?: boolean;
  /**
   * Orchestrator-owned mode. When provided, the list does NOT self-fetch.
   * The orchestrator drives the data through its own useAsyncOperation.
   */
  data?: PaymentsListData;
  /** Loading flag from the orchestrator — disables the toolbar. */
  loading?: boolean;
  /**
   * Error string for orchestrator-owned mode. The orchestrator owns the
   * recovery UI (e.g. <RetryReturnDialog>) — this prop is informational
   * so the list can suppress its empty-state copy if useful.
   */
  error?: string | null;
  /** Called by the list after a successful "Load more" so the orchestrator can sync. */
  onAppendData?(append: PaymentsListData): void;
}

/** Translate a `PaymentsFiltersValue` into the `usePayments().fetchList` query. */
function mapFiltersToParams(
  filters: PaymentsFiltersValue,
  limit: number,
  cursor: string | undefined,
): ListPaymentsParams {
  return {
    scope: filters.scope === 'all' ? undefined : filters.scope,
    direction: filters.direction,
    categoryId: filters.categoryId,
    from: filters.from,
    to: filters.to,
    starred: filters.starred ? true : undefined,
    search: filters.search,
    sort: filters.sort,
    limit,
    cursor,
  };
}

const DEFAULT_LIMIT = 20;

export function PaymentsList({
  filters: controlledFilters,
  onFiltersChange,
  lockScope,
  showFilters = true,
  showControls = true,
  showStar = true,
  limit = DEFAULT_LIMIT,
  emptyState,
  onPaymentClick,
  onPaymentEdit,
  categories,
  disableInternalAdd,
  data: orchestratorData,
  loading: orchestratorLoading,
  error: orchestratorError,
  onAppendData,
}: PaymentsListProps) {
  const t = useTranslations('payments');
  const tListLoading = useTranslations('payments.list');
  const locale = useLocale();
  const router = useRouter();
  const { fetchList, getPayment } = usePayments();

  const isOrchestratorMode = orchestratorData !== undefined;

  const defaultClickHandler = useMemo(
    () => (id: string) => router.push(`/payments/${id}`),
    [router],
  );
  const effectiveClick = onPaymentClick ?? defaultClickHandler;
  void locale;

  // Filters — controlled-or-uncontrolled, unchanged from 6.16.1.
  const [internalFilters, setInternalFilters] = useState<PaymentsFiltersValue>(() =>
    defaultFilters(),
  );
  const filters = controlledFilters ?? internalFilters;

  const setFilters = useCallback(
    (next: PaymentsFiltersValue) => {
      if (controlledFilters !== undefined) {
        onFiltersChange?.(next);
      } else {
        setInternalFilters(next);
      }
    },
    [controlledFilters, onFiltersChange],
  );

  // Self-fetch state (used only when not in orchestrator mode).
  const fetchOp = useAsyncOperation<PaymentListResponse>({
    scope: 'container',
    id: 'payments-list-fetch',
  });
  const [selfRows, setSelfRows] = useState<PaymentSummary[]>([]);
  const [selfCursor, setSelfCursor] = useState<string | null>(null);
  const [selfHasMore, setSelfHasMore] = useState(false);

  // Load-more pagination — same hook in both modes.
  const loadMoreOp = useAsyncOperation<PaymentListResponse>({
    scope: 'container',
    id: 'payments-list-load-more',
  });

  // Dialog state.
  const [paymentToDelete, setPaymentToDelete] = useState<PaymentSummary | null>(null);
  const [paymentToEdit, setPaymentToEdit] = useState<PaymentSummary | null>(null);
  const [creating, setCreating] = useState(false);

  // Track whether the very first self-fetch has completed (used to render
  // the inline "Loading…" placeholder before the first page resolves).
  const firstLoadDoneRef = useRef(isOrchestratorMode);

  // ── Derived view state ──────────────────────────────────────────────
  const rows = isOrchestratorMode ? (orchestratorData?.rows ?? []) : selfRows;
  const cursor = isOrchestratorMode ? (orchestratorData?.cursor ?? null) : selfCursor;
  const hasMore = isOrchestratorMode ? (orchestratorData?.hasMore ?? false) : selfHasMore;
  const loading = isOrchestratorMode ? !!orchestratorLoading : fetchOp.isLoading;
  const error = isOrchestratorMode ? (orchestratorError ?? null) : (fetchOp.error?.message ?? null);

  // ── Realtime sync (Phase 6 · Iteration 6.18.1.4.1) ───────────────────
  //
  // Apply a transform to whichever data source owns the current rows.
  // Self-fetch mode mutates `selfRows`; orchestrator mode bubbles the new
  // shape up via `onAppendData`.
  const applyRowsUpdate = useCallback(
    (updater: (prev: PaymentSummary[]) => PaymentSummary[]) => {
      if (isOrchestratorMode) {
        const next = updater(orchestratorData?.rows ?? []);
        onAppendData?.({
          rows: next,
          cursor: orchestratorData?.cursor ?? null,
          hasMore: orchestratorData?.hasMore ?? false,
        });
      } else {
        setSelfRows((prev) => updater(prev));
      }
    },
    [
      isOrchestratorMode,
      onAppendData,
      orchestratorData?.rows,
      orchestratorData?.cursor,
      orchestratorData?.hasMore,
    ],
  );

  useRealtimeEvents({ type: 'payment.created' }, (event) => {
    if (!paymentMatchesFilters(event.payment, filters)) return;
    applyRowsUpdate((prev) =>
      prev.some((r) => r.id === event.payment.id) ? prev : [event.payment, ...prev],
    );
  });

  useRealtimeEvents({ type: 'payment.updated' }, (event) => {
    applyRowsUpdate((prev) => {
      const idx = prev.findIndex((r) => r.id === event.payment.id);
      if (idx === -1) {
        // Newly visible due to the update: prepend if it now matches filters.
        return paymentMatchesFilters(event.payment, filters) ? [event.payment, ...prev] : prev;
      }
      // Already in the list — drop it if it no longer matches, otherwise patch.
      if (!paymentMatchesFilters(event.payment, filters)) {
        return prev.filter((r) => r.id !== event.payment.id);
      }
      const next = prev.slice();
      next[idx] = event.payment;
      return next;
    });
  });

  useRealtimeEvents({ type: 'payment.deleted' }, (event) => {
    applyRowsUpdate((prev) => prev.filter((r) => r.id !== event.paymentId));
  });

  useRealtimeEvents({ type: 'payment_attribution.removed' }, (event) => {
    // The server may emit this to the user even when they no longer have
    // visibility — treat as a hard remove so stale rows don't linger.
    applyRowsUpdate((prev) => prev.filter((r) => r.id !== event.paymentId));
  });

  // ── Self-fetch on filter change (skipped in orchestrator mode) ────────
  const fetchPage = useCallback(
    async (reset: boolean): Promise<void> => {
      const result = await fetchOp.run((signal) =>
        fetchList(
          mapFiltersToParams(filters, limit, reset ? undefined : (selfCursor ?? undefined)),
          signal,
        ),
      );
      firstLoadDoneRef.current = true;
      if (!result) return;
      setSelfRows((prev) => (reset ? result.data : [...prev, ...result.data]));
      setSelfCursor(result.nextCursor);
      setSelfHasMore(result.hasMore);
    },
    [fetchOp, fetchList, filters, limit, selfCursor],
  );

  // The fetch effect intentionally depends only on `filters` to avoid the
  // re-run loop that `fetchPage` identity changes would cause.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  useEffect(() => {
    if (isOrchestratorMode) return;
    void fetchPageRef.current(true);
  }, [filters, isOrchestratorMode]);

  // ── Row interactions ──────────────────────────────────────────────────

  const handleStarToggled = useCallback(
    (id: string, starred: boolean) => {
      // In orchestrator mode the orchestrator owns the rows; the row's
      // local optimistic flip is already visible. Self-fetch mode mutates
      // the local rows here.
      if (isOrchestratorMode) return;
      setSelfRows((prev) => {
        if (filters.starred && !starred) return prev.filter((r) => r.id !== id);
        return prev.map((r) => (r.id === id ? { ...r, starredByMe: starred } : r));
      });
    },
    [filters.starred, isOrchestratorMode],
  );

  const handleDeleted = useCallback(
    async (result: AttributionChangeResult) => {
      const target = paymentToDelete;
      if (!target) return;
      if (isOrchestratorMode) return; // orchestrator refetches lazily
      if (result.paymentDeleted) {
        setSelfRows((prev) => prev.filter((r) => r.id !== target.id));
        return;
      }
      try {
        const fresh = await getPayment(target.id);
        setSelfRows((prev) => prev.map((r) => (r.id === fresh.id ? fresh : r)));
      } catch {
        setSelfRows((prev) => prev.filter((r) => r.id !== target.id));
      }
    },
    [getPayment, paymentToDelete, isOrchestratorMode],
  );

  const handleEditClick = useCallback(
    (id: string) => {
      onPaymentEdit?.(id);
      const row = rows.find((r) => r.id === id);
      if (row) setPaymentToEdit(row);
    },
    [onPaymentEdit, rows],
  );

  const handleDialogSaved = useCallback(
    async (saved: PaymentSummary | null) => {
      if (paymentToEdit && saved) {
        if (!isOrchestratorMode) {
          setSelfRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        }
        return;
      }
      if (paymentToEdit && !saved) {
        if (!isOrchestratorMode) {
          setSelfRows((prev) => prev.filter((r) => r.id !== paymentToEdit.id));
        }
        return;
      }
      if (!isOrchestratorMode) {
        await fetchPageRef.current(true);
      }
    },
    [paymentToEdit, isOrchestratorMode],
  );

  const handleRetry = () => {
    if (isOrchestratorMode) return;
    void fetchPageRef.current(true);
  };

  const handleLoadMore = async () => {
    if (loading || !hasMore || loadMoreOp.isLoading) return;
    const result = await loadMoreOp.run((signal) =>
      fetchList(mapFiltersToParams(filters, limit, cursor ?? undefined), signal),
    );
    if (!result) return;
    if (isOrchestratorMode) {
      onAppendData?.({
        rows: [...rows, ...result.data],
        cursor: result.nextCursor,
        hasMore: result.hasMore,
      });
    } else {
      setSelfRows((prev) => [...prev, ...result.data]);
      setSelfCursor(result.nextCursor);
      setSelfHasMore(result.hasMore);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  const showLoadingFirst =
    !isOrchestratorMode && !firstLoadDoneRef.current && loading && rows.length === 0;
  const showEmpty = !loading && !error && rows.length === 0;
  const showAddButton = showControls !== false && !disableInternalAdd;

  return (
    <div className="space-y-4" data-testid="payments-list" aria-live="polite">
      {(showFilters || showAddButton) && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          {showFilters ? (
            <PaymentsFilters
              value={filters}
              onChange={setFilters}
              hide={{ scope: lockScope }}
              categories={categories ?? null}
              disabled={loading}
            />
          ) : (
            <div />
          )}
          {showAddButton && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setCreating(true)}
              data-testid="payments-list-add"
            >
              {t('form.addAction')}
            </Button>
          )}
        </div>
      )}

      {showLoadingFirst && (
        <div
          className="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
          data-testid="payments-list-loading"
          role="status"
          aria-live="polite"
        >
          {t('list.loadingMore')}
        </div>
      )}

      {error && !loading && !isOrchestratorMode && (
        <div
          className="flex items-center justify-between gap-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
          role="alert"
          data-testid="payments-list-error"
        >
          <span>{t('list.errorLoading', { message: error })}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            data-testid="payments-list-retry"
          >
            {t('list.retry')}
          </Button>
        </div>
      )}

      {showEmpty && (
        <div
          className="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
          data-testid="payments-list-empty"
        >
          {emptyState ?? t('list.empty')}
        </div>
      )}

      {!showEmpty && rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto md:block" data-testid="payments-list-desktop">
            <table className="w-full text-sm">
              <thead className="text-start text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-2 py-2 text-start" aria-label={t('table.starred')}>
                    ★
                  </th>
                  <th className="px-2 py-2 text-start">{t('table.date')}</th>
                  <th className="px-2 py-2 text-start">{t('table.direction')}</th>
                  <th className="px-2 py-2 text-end">{t('table.amount')}</th>
                  <th className="px-2 py-2 text-start">{t('table.category')}</th>
                  <th className="px-2 py-2 text-start">{t('table.scopes')}</th>
                  <th className="px-2 py-2 text-start">{t('table.note')}</th>
                  <th className="px-2 py-2 text-start">{t('table.controls')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <PaymentRow
                    key={p.id}
                    payment={p}
                    variant="desktop"
                    showStar={showStar}
                    showControls={showControls}
                    onClick={effectiveClick}
                    onEditClick={handleEditClick}
                    onDeleteClick={(payment) => setPaymentToDelete(payment)}
                    onStarToggled={handleStarToggled}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden" data-testid="payments-list-mobile">
            {rows.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                variant="card"
                showStar={showStar}
                showControls={showControls}
                onClick={effectiveClick}
                onEditClick={handleEditClick}
                onDeleteClick={(payment) => setPaymentToDelete(payment)}
                onStarToggled={handleStarToggled}
              />
            ))}
          </ul>
        </>
      )}

      {hasMore && !error && (
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleLoadMore}
            disabled={loading || loadMoreOp.isLoading}
            data-testid="payments-list-load-more"
          >
            {loadMoreOp.isLoading ? (
              <InlineLoader
                label={tListLoading('loadingMore')}
                data-testid="payments-list-load-more-loader"
              />
            ) : (
              t('list.loadMore')
            )}
          </Button>
          {loadMoreOp.isError && (
            <button
              type="button"
              onClick={() => void loadMoreOp.retry()}
              data-testid="payments-list-load-more-retry"
              className="text-xs font-medium text-red-700 underline hover:text-red-800 dark:text-red-300"
            >
              {t('list.retry')}
            </button>
          )}
        </div>
      )}

      {paymentToDelete && (
        <DeletePaymentDialog
          payment={paymentToDelete}
          onClose={() => setPaymentToDelete(null)}
          onDeleted={handleDeleted}
        />
      )}

      {(paymentToEdit || creating) && (
        <PaymentFormDialog
          open
          mode={paymentToEdit ? 'edit' : 'create'}
          payment={paymentToEdit ?? undefined}
          onClose={() => {
            setPaymentToEdit(null);
            setCreating(false);
          }}
          onSaved={handleDialogSaved}
          categories={categories}
        />
      )}
    </div>
  );
}
