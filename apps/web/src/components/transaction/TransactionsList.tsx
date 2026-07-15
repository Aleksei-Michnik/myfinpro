'use client';

// Phase 6 · Iteration 6.12 — top-level reusable transactions list.
// Phase 6 · Iteration 6.16.1 — fully controlled (or uncontrolled) by the
// parent via the `filters` / `onFiltersChange` props.
// Phase 6 · Iteration 6.16.2 — fully migrated to `useAsyncOperation`. Two
// modes:
//
//   1. Self-fetch (the dashboard widgets — `data` prop omitted): the list
//      owns both the first-page fetch and "Load more" pagination through
//      its own container-scope ops. Filter changes trigger a reset fetch.
//
//   2. Orchestrator-owned (`data` prop provided — used by /transactions): the
//      orchestrator owns the first-page fetch and recovery UI. The list
//      reads rows from `data`, and any "Load more" appends are reported
//      back via `onAppendData`. The list still owns the load-more op.
//
// Both modes use the same useAsyncOperation primitive — no hand-rolled
// `setLoading(true)` / inline error state remains.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DeleteTransactionDialog } from './DeleteTransactionDialog';
import { TransactionFormDialog } from './TransactionFormDialog';
import { TransactionRow } from './TransactionRow';
import { TransactionsFilters, type TransactionsFiltersValue } from './TransactionsFilters';
import { AttachReceiptDialog } from '@/components/receipt/AttachReceiptDialog';
import { Button } from '@/components/ui/Button';
import { InlineLoader } from '@/components/ui/InlineLoader';
import { useRouter } from '@/i18n/navigation';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { defaultFilters, transactionMatchesFilters } from '@/lib/transaction/filters';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type {
  AttributionChangeResult,
  CategoryDto,
  ListTransactionsParams,
  TransactionListResponse,
  TransactionSummary,
} from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface TransactionsListData {
  rows: TransactionSummary[];
  cursor: string | null;
  hasMore: boolean;
}

export interface TransactionsListProps {
  filters?: TransactionsFiltersValue;
  onFiltersChange?(next: TransactionsFiltersValue): void;
  /** Hide the scope dropdown — used by /transactions where a tab strip owns scope. */
  lockScope?: boolean;
  /** Toggle the filter toolbar entirely. Default true. */
  showFilters?: boolean;
  /** Per-row controls (edit / delete). Default true. */
  showControls?: boolean;
  /** Per-row star toggle. Default true. */
  showStar?: boolean;
  limit?: number;
  emptyState?: ReactNode;
  onTransactionClick?(id: string): void;
  onTransactionEdit?(id: string): void;
  /** Pre-fetched categories shared across multiple lists. */
  categories?: CategoryDto[] | null;
  /** When true, the toolbar doesn't render the inline "Add transaction" button. */
  disableInternalAdd?: boolean;
  /**
   * Orchestrator-owned mode. When provided, the list does NOT self-fetch.
   * The orchestrator drives the data through its own useAsyncOperation.
   */
  data?: TransactionsListData;
  /** Loading flag from the orchestrator — disables the toolbar. */
  loading?: boolean;
  /**
   * Error string for orchestrator-owned mode. The orchestrator owns the
   * recovery UI (e.g. <RetryReturnDialog>) — this prop is informational
   * so the list can suppress its empty-state copy if useful.
   */
  error?: string | null;
  /** Called by the list after a successful "Load more" so the orchestrator can sync. */
  onAppendData?(append: TransactionsListData): void;
}

/** Translate a `TransactionsFiltersValue` into the `useTransactions().fetchList` query. */
function mapFiltersToParams(
  filters: TransactionsFiltersValue,
  limit: number,
  cursor: string | undefined,
): ListTransactionsParams {
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

export function TransactionsList({
  filters: controlledFilters,
  onFiltersChange,
  lockScope,
  showFilters = true,
  showControls = true,
  showStar = true,
  limit = DEFAULT_LIMIT,
  emptyState,
  onTransactionClick,
  onTransactionEdit,
  categories,
  disableInternalAdd,
  data: orchestratorData,
  loading: orchestratorLoading,
  error: orchestratorError,
  onAppendData,
}: TransactionsListProps) {
  const t = useTranslations('transactions');
  const tListLoading = useTranslations('transactions.list');
  const locale = useLocale();
  const router = useRouter();
  const { fetchList, getTransaction } = useTransactions();

  const isOrchestratorMode = orchestratorData !== undefined;

  const defaultClickHandler = useMemo(
    () => (id: string) => router.push(`/transactions/${id}`),
    [router],
  );
  const effectiveClick = onTransactionClick ?? defaultClickHandler;
  void locale;

  // Filters — controlled-or-uncontrolled, unchanged from 6.16.1.
  const [internalFilters, setInternalFilters] = useState<TransactionsFiltersValue>(() =>
    defaultFilters(),
  );
  const filters = controlledFilters ?? internalFilters;

  const setFilters = useCallback(
    (next: TransactionsFiltersValue) => {
      if (controlledFilters !== undefined) {
        onFiltersChange?.(next);
      } else {
        setInternalFilters(next);
      }
    },
    [controlledFilters, onFiltersChange],
  );

  // Self-fetch state (used only when not in orchestrator mode).
  const fetchOp = useAsyncOperation<TransactionListResponse>({
    scope: 'container',
    id: 'transactions-list-fetch',
  });
  const [selfRows, setSelfRows] = useState<TransactionSummary[]>([]);
  const [selfCursor, setSelfCursor] = useState<string | null>(null);
  const [selfHasMore, setSelfHasMore] = useState(false);

  // Load-more pagination — same hook in both modes.
  const loadMoreOp = useAsyncOperation<TransactionListResponse>({
    scope: 'container',
    id: 'transactions-list-load-more',
  });

  // Dialog state.
  const [transactionToDelete, setTransactionToDelete] = useState<TransactionSummary | null>(null);
  const [transactionToEdit, setTransactionToEdit] = useState<TransactionSummary | null>(null);
  const [transactionToAttach, setTransactionToAttach] = useState<TransactionSummary | null>(null);
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
    (updater: (prev: TransactionSummary[]) => TransactionSummary[]) => {
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

  useRealtimeEvents({ type: 'transaction.created' }, (event) => {
    if (!transactionMatchesFilters(event.transaction, filters)) return;
    applyRowsUpdate((prev) =>
      prev.some((r) => r.id === event.transaction.id) ? prev : [event.transaction, ...prev],
    );
  });

  useRealtimeEvents({ type: 'transaction.updated' }, (event) => {
    applyRowsUpdate((prev) => {
      const idx = prev.findIndex((r) => r.id === event.transaction.id);
      if (idx === -1) {
        // Newly visible due to the update: prepend if it now matches filters.
        return transactionMatchesFilters(event.transaction, filters)
          ? [event.transaction, ...prev]
          : prev;
      }
      // Already in the list — drop it if it no longer matches, otherwise patch.
      if (!transactionMatchesFilters(event.transaction, filters)) {
        return prev.filter((r) => r.id !== event.transaction.id);
      }
      const next = prev.slice();
      next[idx] = event.transaction;
      return next;
    });
  });

  useRealtimeEvents({ type: 'transaction.deleted' }, (event) => {
    applyRowsUpdate((prev) => prev.filter((r) => r.id !== event.transactionId));
  });

  useRealtimeEvents({ type: 'transaction_attribution.removed' }, (event) => {
    // The server may emit this to the user even when they no longer have
    // visibility — treat as a hard remove so stale rows don't linger.
    applyRowsUpdate((prev) => prev.filter((r) => r.id !== event.transactionId));
  });

  // Phase 6 · Iteration 6.18.1.4.3 — when a recurring schedule fires a new
  // occurrence (a child Transaction), the producer emits `occurrence.created`
  // (NOT `transaction.created`) so detail pages can react with a dedicated
  // affordance. Dashboard / list views that show all transactions still need
  // the row to appear — handle it here so RecentActivity & friends stay
  // live without each widget re-implementing the dispatch.
  useRealtimeEvents({ type: 'occurrence.created' }, (event) => {
    if (!transactionMatchesFilters(event.transaction, filters)) return;
    applyRowsUpdate((prev) =>
      prev.some((r) => r.id === event.transaction.id) ? prev : [event.transaction, ...prev],
    );
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

  // Phase 6 · 6.18.1.4-hotfix (part 2) — gap recovery. On a realtime
  // reconnect-after-gap the in-memory bus has no replay; refetch the
  // first page to re-establish authoritative state. Orchestrator mode
  // handles its own resync upstream (in transactions-list-client).
  useRealtimeResync(() => {
    if (isOrchestratorMode) return;
    void fetchPageRef.current(true);
  });

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
      const target = transactionToDelete;
      if (!target) return;
      if (isOrchestratorMode) return; // orchestrator refetches lazily
      if (result.transactionDeleted) {
        setSelfRows((prev) => prev.filter((r) => r.id !== target.id));
        return;
      }
      try {
        const fresh = await getTransaction(target.id);
        setSelfRows((prev) => prev.map((r) => (r.id === fresh.id ? fresh : r)));
      } catch {
        setSelfRows((prev) => prev.filter((r) => r.id !== target.id));
      }
    },
    [getTransaction, transactionToDelete, isOrchestratorMode],
  );

  const handleEditClick = useCallback(
    (id: string) => {
      onTransactionEdit?.(id);
      const row = rows.find((r) => r.id === id);
      if (row) setTransactionToEdit(row);
    },
    [onTransactionEdit, rows],
  );

  const handleDialogSaved = useCallback(
    async (saved: TransactionSummary | null) => {
      if (transactionToEdit && saved) {
        if (!isOrchestratorMode) {
          setSelfRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        }
        return;
      }
      if (transactionToEdit && !saved) {
        if (!isOrchestratorMode) {
          setSelfRows((prev) => prev.filter((r) => r.id !== transactionToEdit.id));
        }
        return;
      }
      if (!isOrchestratorMode) {
        await fetchPageRef.current(true);
      }
    },
    [transactionToEdit, isOrchestratorMode],
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
    <div className="space-y-4" data-testid="transactions-list" aria-live="polite">
      {(showFilters || showAddButton) && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          {showFilters ? (
            <TransactionsFilters
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
              data-testid="transactions-list-add"
            >
              {t('form.addAction')}
            </Button>
          )}
        </div>
      )}

      {showLoadingFirst && (
        <div
          className="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
          data-testid="transactions-list-loading"
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
          data-testid="transactions-list-error"
        >
          <span>{t('list.errorLoading', { message: error })}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            data-testid="transactions-list-retry"
          >
            {t('list.retry')}
          </Button>
        </div>
      )}

      {showEmpty && (
        <div
          className="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
          data-testid="transactions-list-empty"
        >
          {emptyState ?? t('list.empty')}
        </div>
      )}

      {!showEmpty && rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto md:block" data-testid="transactions-list-desktop">
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
                  <TransactionRow
                    key={p.id}
                    transaction={p}
                    variant="desktop"
                    showStar={showStar}
                    showControls={showControls}
                    onClick={effectiveClick}
                    onEditClick={handleEditClick}
                    onDeleteClick={(transaction) => setTransactionToDelete(transaction)}
                    onAttachClick={(transaction) => setTransactionToAttach(transaction)}
                    onStarToggled={handleStarToggled}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden" data-testid="transactions-list-mobile">
            {rows.map((p) => (
              <TransactionRow
                key={p.id}
                transaction={p}
                variant="card"
                showStar={showStar}
                showControls={showControls}
                onClick={effectiveClick}
                onEditClick={handleEditClick}
                onDeleteClick={(transaction) => setTransactionToDelete(transaction)}
                onAttachClick={(transaction) => setTransactionToAttach(transaction)}
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
            data-testid="transactions-list-load-more"
          >
            {loadMoreOp.isLoading ? (
              <InlineLoader
                label={tListLoading('loadingMore')}
                data-testid="transactions-list-load-more-loader"
              />
            ) : (
              t('list.loadMore')
            )}
          </Button>
          {loadMoreOp.isError && (
            <button
              type="button"
              onClick={() => void loadMoreOp.retry()}
              data-testid="transactions-list-load-more-retry"
              className="text-xs font-medium text-red-700 underline hover:text-red-800 dark:text-red-300"
            >
              {t('list.retry')}
            </button>
          )}
        </div>
      )}

      {transactionToDelete && (
        <DeleteTransactionDialog
          transaction={transactionToDelete}
          onClose={() => setTransactionToDelete(null)}
          onDeleted={handleDeleted}
        />
      )}

      {(transactionToEdit || creating) && (
        <TransactionFormDialog
          open
          mode={transactionToEdit ? 'edit' : 'create'}
          transaction={transactionToEdit ?? undefined}
          onClose={() => {
            setTransactionToEdit(null);
            setCreating(false);
          }}
          onSaved={handleDialogSaved}
          categories={categories}
        />
      )}

      {/* Attach a receipt to an existing expense transaction (Phase 8.15) — the
          linked receipt hands off to review → reconcile. */}
      {transactionToAttach && (
        <AttachReceiptDialog
          open
          transactionId={transactionToAttach.id}
          onClose={() => setTransactionToAttach(null)}
          onAttached={(receipt) => {
            setTransactionToAttach(null);
            router.push(`/receipts/${receipt.id}`);
          }}
        />
      )}
    </div>
  );
}
