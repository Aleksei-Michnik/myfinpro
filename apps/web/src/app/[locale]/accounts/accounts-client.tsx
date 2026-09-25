'use client';

// Phase 20 · Iteration 20.3 — the /accounts list page (UI spec §1): account
// cards, scope tabs, show-archived toggle, cursor "load more", and the
// create / edit / archive / delete flows. Same orchestrator shape as the
// budgets page (docs/ui-async-conventions.md): controls bind to `committed`
// filters only, a pending intent stays invisible until its fetch commits,
// failures open <RetryReturnDialog> without moving the controls. Realtime:
// `account.updated` and every `transaction.*` event (balances derive from
// transactions) refetch the committed first page, as does a resync.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountCard } from '@/components/account/AccountCard';
import { AccountFormDialog } from '@/components/account/AccountFormDialog';
import { TransactionsScopeTabs } from '@/components/transaction/TransactionsScopeTabs';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { PageHeader } from '@/components/ui/PageHeader';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { useToast } from '@/components/ui/Toast';
import { useAccounts } from '@/lib/account/account-context';
import type { AccountListResponse, AccountSummary, ListAccountsParams } from '@/lib/account/types';
import { useGroups } from '@/lib/group/group-context';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useAsyncOperation, useResetOnLocaleChange } from '@/lib/ui';

const PAGE_LIMIT = 20;

interface AccountFilters {
  /** `'all'` | `'personal'` | `'group:<id>'` — the list API's `scope=`. */
  scope: string;
  includeArchived: boolean;
}

const DEFAULT_FILTERS: AccountFilters = { scope: 'all', includeArchived: false };

function paramsFor(filters: AccountFilters, cursor?: string): ListAccountsParams {
  return {
    scope: filters.scope === 'all' ? undefined : filters.scope,
    includeArchived: filters.includeArchived || undefined,
    limit: PAGE_LIMIT,
    cursor,
  };
}

export function AccountsClient() {
  const t = useTranslations('accounts.list');
  const tDelete = useTranslations('accounts.delete');
  const { groups } = useGroups();
  const { fetchAccounts, deleteAccount, archiveAccount, unarchiveAccount } = useAccounts();
  const { addToast } = useToast();

  const [committed, setCommitted] = useState<AccountFilters>(DEFAULT_FILTERS);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AccountSummary | null>(null);
  const [deleting, setDeleting] = useState<AccountSummary | null>(null);

  const listOp = useAsyncOperation<AccountListResponse>({
    scope: 'container',
    id: 'accounts-page-fetch',
  });
  const archiveOp = useAsyncOperation<AccountSummary>({ scope: 'control', id: 'accounts-archive' });
  const deleteOp = useAsyncOperation<boolean>({ scope: 'control', id: 'accounts-delete' });

  const fetchAccountsRef = useRef(fetchAccounts);
  fetchAccountsRef.current = fetchAccounts;
  const listOpRef = useRef(listOp);
  listOpRef.current = listOp;
  const committedRef = useRef(committed);
  committedRef.current = committed;
  // Newest-fetch guard: only the latest failure may open the recovery dialog.
  const fetchSeqRef = useRef(0);
  const pendingIntentRef = useRef<AccountFilters | null>(null);
  const pendingCursorRef = useRef<string | undefined>(undefined);

  const runFetch = useCallback(async (intent: AccountFilters, cursor?: string) => {
    const seq = ++fetchSeqRef.current;
    pendingIntentRef.current = intent;
    pendingCursorRef.current = cursor;
    setShowErrorDialog(false);
    const result = await listOpRef.current.run((signal) =>
      fetchAccountsRef.current(paramsFor(intent, cursor), signal),
    );
    if (result === undefined) {
      if (fetchSeqRef.current === seq) setShowErrorDialog(true);
      return;
    }
    setCommitted(intent);
    setHasLoadedOnce(true);
    setAccounts((prev) => {
      if (cursor === undefined) return result.data;
      const known = new Set(prev.map((a) => a.id));
      return [...prev, ...result.data.filter((a) => !known.has(a.id))];
    });
    setNextCursor(result.nextCursor);
    pendingIntentRef.current = null;
    pendingCursorRef.current = undefined;
  }, []);

  const commit = useCallback((intent: AccountFilters) => void runFetch(intent), [runFetch]);

  const didMountFetchRef = useRef(false);
  useEffect(() => {
    if (didMountFetchRef.current) return;
    didMountFetchRef.current = true;
    commit(committedRef.current);
  }, [commit]);

  useResetOnLocaleChange(() => {
    setShowErrorDialog(false);
    commit(committedRef.current);
  });

  const refetch = useCallback(() => commit(committedRef.current), [commit]);
  useRealtimeResync(refetch);
  useRealtimeEvents({ type: 'account.updated' }, refetch);
  useRealtimeEvents({ type: 'transaction.created' }, refetch);
  useRealtimeEvents({ type: 'transaction.updated' }, refetch);
  useRealtimeEvents({ type: 'transaction.deleted' }, refetch);

  const handleScopeChange = (scope: string) => commit({ ...committedRef.current, scope });
  const handleArchivedToggle = () =>
    commit({ ...committedRef.current, includeArchived: !committedRef.current.includeArchived });
  const loadMore = () => {
    if (nextCursor) void runFetch(committedRef.current, nextCursor);
  };

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

  const replaceById = (updated: AccountSummary) =>
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));

  const handleToggleArchive = (account: AccountSummary) => {
    const wasArchived = account.archivedAt !== null && account.archivedAt !== undefined;
    void archiveOp
      .run((signal) =>
        wasArchived ? unarchiveAccount(account.id, signal) : archiveAccount(account.id, signal),
      )
      .then((updated) => {
        if (updated === undefined) return;
        setAccounts((prev) => {
          if (updated.archivedAt && !committedRef.current.includeArchived) {
            return prev.filter((a) => a.id !== updated.id);
          }
          return prev.map((a) => (a.id === updated.id ? updated : a));
        });
        addToast('success', wasArchived ? t('unarchivedToast') : t('archivedToast'));
      });
  };

  const handleDeleteConfirm = () => {
    const account = deleting;
    if (!account) return;
    void deleteOp
      .run(async (signal) => {
        await deleteAccount(account.id, signal);
        return true;
      })
      .then((ok) => {
        if (!ok) return;
        setAccounts((prev) => prev.filter((a) => a.id !== account.id));
        setDeleting(null);
        addToast('success', t('deletedToast'));
      });
  };

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

  const loading = listOp.isLoading;
  const filtered = committed.scope !== 'all' || committed.includeArchived;

  return (
    <main
      id="main-content"
      className="container mx-auto max-w-5xl space-y-4 px-4 py-8"
      data-testid="accounts-page"
    >
      <PageHeader
        title={t('title')}
        actions={
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            data-testid="accounts-new"
          >
            {t('newAccount')}
          </Button>
        }
      />

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
          data-testid="accounts-archived-toggle"
          className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            committed.includeArchived
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-200'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
          }`}
        >
          {t('showArchived')}
        </button>
      </div>

      <div className="relative" data-testid="accounts-content">
        {!hasLoadedOnce && loading ? (
          <div
            className="grid gap-3 md:grid-cols-2"
            role="status"
            aria-label={t('loading')}
            data-testid="accounts-loading"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none dark:bg-gray-800"
              />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          filtered ? (
            <EmptyState data-testid="accounts-empty" title={t('emptyFiltered')} />
          ) : (
            <EmptyState
              data-testid="accounts-empty"
              title={t('emptyTitle')}
              description={t('emptyBody')}
              action={
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  data-testid="accounts-empty-new"
                >
                  {t('newAccount')}
                </Button>
              }
            />
          )
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="accounts-list">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
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
              data-testid="accounts-load-more"
            >
              {t('loadMore')}
            </Button>
          </div>
        )}

        <LoadingOverlay active={loading && hasLoadedOnce} />
      </div>

      <AccountFormDialog
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          // The new account may sit outside the committed filters — refetch
          // the first page instead of guessing.
          commit(committedRef.current);
        }}
      />

      {editing && (
        <AccountFormDialog
          open
          mode="edit"
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            replaceById(updated);
            setEditing(null);
          }}
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
