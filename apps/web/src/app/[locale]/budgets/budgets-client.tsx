'use client';

// Phase 10 · Iteration 10.4 — the full /budgets list page (design §7):
// budget cards, scope filter tabs, show-archived toggle, cursor "load
// more", and the edit / delete / archive flows. The orchestrator follows
// the /transactions commit pattern (docs/ui-async-conventions.md): the
// visual controls bind to `committed` filters only, a pending intent stays
// invisible until its fetch commits, and failures open <RetryReturnDialog>
// without moving the controls. Realtime: `budget.updated` events and
// reconnect-after-gap resyncs refetch the committed first page
// (docs/ui-realtime-conventions.md).

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BudgetCard } from '@/components/budget/BudgetCard';
import { BudgetFormDialog } from '@/components/budget/BudgetFormDialog';
import { CreateBudgetDialog } from '@/components/budget/CreateBudgetDialog';
import { TransactionsScopeTabs } from '@/components/transaction/TransactionsScopeTabs';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { useToast } from '@/components/ui/Toast';
import { useBudgets } from '@/lib/budget/budget-context';
import type { BudgetListResponse, BudgetSummary, ListBudgetsParams } from '@/lib/budget/types';
import { useGroups } from '@/lib/group/group-context';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useAsyncOperation, useResetOnLocaleChange } from '@/lib/ui';

const PAGE_LIMIT = 20;

interface BudgetFilters {
  /** `'all'` | `'personal'` | `'group:<id>'` — the list API's `scope=`. */
  scope: string;
  includeArchived: boolean;
}

const DEFAULT_FILTERS: BudgetFilters = { scope: 'all', includeArchived: false };

function paramsFor(filters: BudgetFilters, cursor?: string): ListBudgetsParams {
  return {
    scope: filters.scope === 'all' ? undefined : filters.scope,
    includeArchived: filters.includeArchived || undefined,
    limit: PAGE_LIMIT,
    cursor,
  };
}

export function BudgetsClient() {
  const t = useTranslations('budgets.list');
  const tDelete = useTranslations('budgets.delete');
  const { groups } = useGroups();
  const { fetchBudgets, deleteBudget, archiveBudget, unarchiveBudget } = useBudgets();
  const { addToast } = useToast();

  const [committed, setCommitted] = useState<BudgetFilters>(DEFAULT_FILTERS);
  const [budgets, setBudgets] = useState<BudgetSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetSummary | null>(null);
  const [deleting, setDeleting] = useState<BudgetSummary | null>(null);

  const listOp = useAsyncOperation<BudgetListResponse>({
    scope: 'container',
    id: 'budgets-page-fetch',
  });
  // Archive / unarchive — one control-scope op shared by all cards
  // (receipts-page row pattern); failures surface as an error toast.
  const archiveOp = useAsyncOperation<BudgetSummary>({ scope: 'control' });
  const deleteOp = useAsyncOperation<boolean>({ scope: 'control' });

  // Stable refs so the commit pipeline keeps a stable identity.
  const fetchBudgetsRef = useRef(fetchBudgets);
  fetchBudgetsRef.current = fetchBudgets;
  const listOpRef = useRef(listOp);
  listOpRef.current = listOp;
  const committedRef = useRef(committed);
  committedRef.current = committed;
  // Newest-fetch guard: a superseded run (SSE refetch racing a click) must
  // not open the recovery dialog — only the latest failure may.
  const fetchSeqRef = useRef(0);
  // The last attempted fetch, re-issued by the dialog's Retry.
  const pendingIntentRef = useRef<BudgetFilters | null>(null);
  const pendingCursorRef = useRef<string | undefined>(undefined);

  // ── Fetch pipeline — first page (cursor undefined) or "load more" ───────
  const runFetch = useCallback(async (intent: BudgetFilters, cursor?: string) => {
    const seq = ++fetchSeqRef.current;
    pendingIntentRef.current = intent;
    pendingCursorRef.current = cursor;
    setShowErrorDialog(false);
    const result = await listOpRef.current.run((signal) =>
      fetchBudgetsRef.current(paramsFor(intent, cursor), signal),
    );
    if (result === undefined) {
      if (fetchSeqRef.current === seq) setShowErrorDialog(true);
      return;
    }
    setCommitted(intent);
    setHasLoadedOnce(true);
    setBudgets((prev) => {
      if (cursor === undefined) return result.data;
      const known = new Set(prev.map((b) => b.id));
      return [...prev, ...result.data.filter((b) => !known.has(b.id))];
    });
    setNextCursor(result.nextCursor);
    pendingIntentRef.current = null;
    pendingCursorRef.current = undefined;
  }, []);

  const commit = useCallback((intent: BudgetFilters) => void runFetch(intent), [runFetch]);

  // Initial mount — exactly once.
  const didMountFetchRef = useRef(false);
  useEffect(() => {
    if (didMountFetchRef.current) return;
    didMountFetchRef.current = true;
    commit(committedRef.current);
  }, [commit]);

  // Locale flip (en ↔ he) — clear a stale error and re-issue quietly.
  useResetOnLocaleChange(() => {
    setShowErrorDialog(false);
    commit(committedRef.current);
  });

  // Reconnect-after-gap — events published into the gap are lost; refetch.
  useRealtimeResync(() => {
    commit(committedRef.current);
  });

  // Advisory budget lifecycle event (design §2.6) — the event only carries
  // the id, so refetch the committed first page (idempotent overwrite).
  useRealtimeEvents({ type: 'budget.updated' }, () => {
    commit(committedRef.current);
  });

  // ── Filter handlers — all funnel into commit() ──────────────────────────
  const handleScopeChange = (scope: string) => commit({ ...committedRef.current, scope });
  const handleArchivedToggle = () =>
    commit({
      ...committedRef.current,
      includeArchived: !committedRef.current.includeArchived,
    });
  const loadMore = () => {
    if (nextCursor) void runFetch(committedRef.current, nextCursor);
  };

  // ── Recovery dialog ──────────────────────────────────────────────────────
  const handleRetry = () => {
    setShowErrorDialog(false);
    void runFetch(pendingIntentRef.current ?? committedRef.current, pendingCursorRef.current);
  };
  const handleReturn = () => {
    setShowErrorDialog(false);
    listOpRef.current.cancel();
    pendingIntentRef.current = null;
    pendingCursorRef.current = undefined;
  };

  // ── Mutations — local state updates on the HTTP response, never the echo ─
  const replaceById = (updated: BudgetSummary) =>
    setBudgets((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));

  const handleSaved = (updated: BudgetSummary) => {
    replaceById(updated);
    setEditing(null);
  };

  const handleToggleArchive = (budget: BudgetSummary) => {
    const wasArchived = budget.archivedAt !== null;
    void archiveOp
      .run((signal) =>
        wasArchived ? unarchiveBudget(budget.id, signal) : archiveBudget(budget.id, signal),
      )
      .then((updated) => {
        if (updated === undefined) return;
        setBudgets((prev) => {
          // A freshly-archived budget drops out of a hide-archived list;
          // everything else is replace-by-id.
          if (updated.archivedAt !== null && !committedRef.current.includeArchived) {
            return prev.filter((b) => b.id !== updated.id);
          }
          return prev.map((b) => (b.id === updated.id ? updated : b));
        });
        addToast('success', wasArchived ? t('unarchivedToast') : t('archivedToast'));
      });
  };

  const handleDeleteConfirm = () => {
    const budget = deleting;
    if (!budget) return;
    void deleteOp
      .run(async (signal) => {
        await deleteBudget(budget.id, signal);
        return true;
      })
      .then((ok) => {
        if (!ok) return;
        setBudgets((prev) => prev.filter((b) => b.id !== budget.id));
        setDeleting(null);
        addToast('success', t('deletedToast'));
      });
  };

  // Row-mutation failures → error toast (receipts-page pattern).
  useEffect(() => {
    if (archiveOp.error && archiveOp.error.reason !== 'aborted') {
      addToast('error', archiveOp.error.message || t('actionFailed'));
    }
  }, [archiveOp.error, addToast, t]);
  useEffect(() => {
    if (deleteOp.error && deleteOp.error.reason !== 'aborted') {
      addToast('error', deleteOp.error.message || t('actionFailed'));
    }
  }, [deleteOp.error, addToast, t]);

  // ── Render ───────────────────────────────────────────────────────────────
  const loading = listOp.isLoading;

  return (
    <main className="container mx-auto max-w-3xl space-y-4 px-4 py-8" data-testid="budgets-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setCreateOpen(true)}
          data-testid="budgets-new"
        >
          {t('newBudget')}
        </Button>
      </div>

      <TransactionsScopeTabs
        current={committed.scope}
        groups={groups}
        onChange={handleScopeChange}
        disabled={loading}
      />

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => {
            if (loading) return;
            handleArchivedToggle();
          }}
          disabled={loading}
          aria-disabled={loading || undefined}
          aria-pressed={committed.includeArchived}
          data-testid="budgets-archived-toggle"
          className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            committed.includeArchived
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-200'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
          }`}
        >
          {t('showArchived')}
        </button>
      </div>

      <div className="relative" data-testid="budgets-content">
        {!hasLoadedOnce && loading ? (
          <div
            className="space-y-2"
            role="status"
            aria-label={t('loading')}
            data-testid="budgets-loading"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none dark:bg-gray-800"
              />
            ))}
          </div>
        ) : budgets.length === 0 ? (
          <div
            className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400"
            data-testid="budgets-empty"
          >
            {t('empty')}
          </div>
        ) : (
          <ul className="space-y-2" data-testid="budgets-list">
            {budgets.map((budget) => (
              <BudgetCard
                key={budget.id}
                budget={budget}
                groups={groups}
                actionsDisabled={archiveOp.isLoading}
                onEdit={setEditing}
                onToggleArchive={handleToggleArchive}
                onDelete={setDeleting}
              />
            ))}
          </ul>
        )}

        {nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={loadMore}
              data-testid="budgets-load-more"
            >
              {t('loadMore')}
            </Button>
          </div>
        )}

        <LoadingOverlay active={loading && hasLoadedOnce} />
      </div>

      <CreateBudgetDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          // The new budget may sit outside the committed filters — refetch
          // the first page instead of guessing.
          commit(committedRef.current);
        }}
      />

      {editing && (
        <BudgetFormDialog
          open
          mode="edit"
          budget={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={tDelete('title')}
          message={tDelete('warning', { name: deleting.name })}
          confirmLabel={tDelete('confirm')}
          cancelLabel={tDelete('cancel')}
          danger
          busy={deleteOp.isLoading}
          onConfirm={handleDeleteConfirm}
          onClose={() => {
            deleteOp.cancel();
            setDeleting(null);
          }}
        />
      )}

      <RetryReturnDialog
        open={showErrorDialog}
        reason={listOp.error?.reason ?? 'unknown'}
        httpStatus={listOp.error?.httpStatus}
        onRetry={handleRetry}
        onReturn={handleReturn}
      />
    </main>
  );
}
