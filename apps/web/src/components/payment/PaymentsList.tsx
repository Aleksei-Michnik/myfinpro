'use client';

// Phase 6 · Iteration 6.12 — top-level reusable payments list.
//
// Drives every Phase 6 list surface: dashboard recent (6.15), the dedicated
// /payments page (6.16), and the group-tab (6.16). The component owns its
// own filter state, cursor pagination, error handling, and delete dialog.
//
// Responsibilities deliberately *not* included here:
//   - Edit dialog (6.13). The row exposes onEditClick(id) and we forward
//     it to the parent if provided; otherwise it's a no-op.
//   - Page-level routing — `/payments`, `/payments/[id]`, `/payments/starred`.
//   - Aggregated dashboard summary cards (6.15).

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DeletePaymentDialog } from './DeletePaymentDialog';
import { PaymentFormDialog } from './PaymentFormDialog';
import { PaymentRow } from './PaymentRow';
import { PaymentsFilters, type PaymentsFiltersValue } from './PaymentsFilters';
import { Button } from '@/components/ui/Button';
import { useRouter } from '@/i18n/navigation';
import { usePayments } from '@/lib/payment/payment-context';
import type {
  AttributionChangeResult,
  CategoryDto,
  ListPaymentsParams,
  PaymentSummary,
} from '@/lib/payment/types';

export interface PaymentsListProps {
  /** Locks the scope filter (and hides its dropdown). */
  scope?: 'all' | 'personal' | string;
  initialFilters?: Partial<PaymentsFiltersValue>;
  /** Toggle the filter toolbar entirely. Default true. */
  showFilters?: boolean;
  /** Per-row controls (edit / delete). Default true. */
  showControls?: boolean;
  /** Per-row star toggle. Default true. */
  showStar?: boolean;
  limit?: number;
  emptyState?: ReactNode;
  onPaymentClick?(id: string): void;
  /** Optional edit handler — bubbles through the row. No-op when omitted. */
  onPaymentEdit?(id: string): void;
  /** Pre-fetched categories shared across multiple lists. */
  categories?: CategoryDto[] | null;
  /**
   * When true, the toolbar doesn't render the inline "Add payment" button.
   * The dashboard sets this on its embedded RecentActivity / StarredPayments
   * because it has its own primary `<QuickAddPaymentButton>` at the top.
   */
  disableInternalAdd?: boolean;
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
  scope,
  initialFilters,
  showFilters = true,
  showControls = true,
  showStar = true,
  limit = DEFAULT_LIMIT,
  emptyState,
  onPaymentClick,
  onPaymentEdit,
  categories,
  disableInternalAdd,
}: PaymentsListProps) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const router = useRouter();
  const { fetchList, getPayment } = usePayments();

  // When the caller didn't wire a click handler, default to navigating to
  // the detail page. Locale prefix is injected by next-intl's router.
  const defaultClickHandler = useMemo(
    () => (id: string) => router.push(`/payments/${id}`),
    [router],
  );
  const effectiveClick = onPaymentClick ?? defaultClickHandler;
  // Silence unused-locale warning in case the linter cares; the value is also
  // referenced for RTL-aware Intl contexts in downstream iterations.
  void locale;

  const [filters, setFilters] = useState<PaymentsFiltersValue>(() => ({
    sort: initialFilters?.sort ?? 'date_desc',
    scope: scope ?? initialFilters?.scope ?? 'all',
    direction: initialFilters?.direction,
    starred: initialFilters?.starred,
    categoryId: initialFilters?.categoryId,
    search: initialFilters?.search,
    from: initialFilters?.from,
    to: initialFilters?.to,
  }));

  // Keep filters in sync when parent forces a new locked scope.
  const lastScopeRef = useRef(scope);
  useEffect(() => {
    if (scope !== undefined && lastScopeRef.current !== scope) {
      lastScopeRef.current = scope;
      setFilters((prev) => ({ ...prev, scope }));
    }
  }, [scope]);

  const [rows, setRows] = useState<PaymentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<PaymentSummary | null>(null);
  const [paymentToEdit, setPaymentToEdit] = useState<PaymentSummary | null>(null);
  const [creating, setCreating] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────────────
  // We pin filters / cursor / limit via a ref so the callback identity stays
  // stable, avoiding effect re-runs that would re-trigger the fetch loop.
  const stateRef = useRef({ filters, cursor, limit });
  stateRef.current = { filters, cursor, limit };

  const fetchPage = useCallback(
    async (reset: boolean) => {
      const { filters: f, cursor: c, limit: l } = stateRef.current;
      setLoading(true);
      setError(null);
      try {
        const params = mapFiltersToParams(f, l, reset ? undefined : (c ?? undefined));
        const res = await fetchList(params);
        setRows((prev) => (reset ? res.data : [...prev, ...res.data]));
        setCursor(res.nextCursor);
        setHasMore(res.hasMore);
      } catch (e) {
        setError((e as Error).message || 'Failed to load payments');
      } finally {
        setLoading(false);
        setFirstLoad(false);
      }
    },
    [fetchList],
  );

  // Re-fetch when filters change (full reset).
  useEffect(() => {
    void fetchPage(true);
    // We deliberately depend on `filters` only — fetchPage is stable.
  }, [filters, fetchPage]);

  // ── Row interactions ──────────────────────────────────────────────────────

  const handleStarToggled = useCallback(
    (id: string, starred: boolean) => {
      // If the active filter is "starred only" and a row was unstarred,
      // remove it from the visible list. Otherwise update in place.
      setRows((prev) => {
        if (filters.starred && !starred) {
          return prev.filter((r) => r.id !== id);
        }
        return prev.map((r) => (r.id === id ? { ...r, starredByMe: starred } : r));
      });
    },
    [filters.starred],
  );

  const handleDeleted = useCallback(
    async (result: AttributionChangeResult) => {
      const target = paymentToDelete;
      if (!target) return;
      if (result.paymentDeleted) {
        setRows((prev) => prev.filter((r) => r.id !== target.id));
        return;
      }
      // Otherwise the payment still exists for someone — refresh the row.
      try {
        const fresh = await getPayment(target.id);
        setRows((prev) => prev.map((r) => (r.id === fresh.id ? fresh : r)));
      } catch {
        // We lost visibility (caller no longer has any attribution) — drop it.
        setRows((prev) => prev.filter((r) => r.id !== target.id));
      }
    },
    [getPayment, paymentToDelete],
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
        setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        return;
      }
      if (paymentToEdit && !saved) {
        // Edit hard-deleted the payment (attributions=[] edge case).
        setRows((prev) => prev.filter((r) => r.id !== paymentToEdit.id));
        return;
      }
      // Create mode — refetch first page to get correct ordering + filtering.
      await fetchPage(true);
    },
    [paymentToEdit, fetchPage],
  );

  const handleRetry = () => {
    void fetchPage(true);
  };

  const handleLoadMore = () => {
    if (loading || !hasMore) return;
    void fetchPage(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const showLoadingFirst = firstLoad && loading;
  const showEmpty = !loading && !error && rows.length === 0;

  const showAddButton = showControls !== false && !disableInternalAdd;

  return (
    <div className="space-y-4" data-testid="payments-list">
      {(showFilters || showAddButton) && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          {showFilters ? (
            <PaymentsFilters
              value={filters}
              onChange={setFilters}
              hide={{ scope: scope !== undefined }}
              categories={categories ?? null}
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

      {error && !loading && (
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
          {/* Desktop variant — visible at md+ */}
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

          {/* Card variant — visible below md */}
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
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleLoadMore}
            disabled={loading}
            data-testid="payments-list-load-more"
          >
            {loading ? t('list.loadingMore') : t('list.loadMore')}
          </Button>
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
