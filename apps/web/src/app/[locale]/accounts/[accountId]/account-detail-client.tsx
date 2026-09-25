'use client';

// Phase 20 · 20.5 — `/accounts/[accountId]` (UI spec §2): header with the
// three balances, URL-synced tabs (review · transactions · imports), the
// import wizard and the edit dialog. The Review tab owns the queue.

import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountFormDialog } from '@/components/account/AccountFormDialog';
import { AccountImportsList } from '@/components/account/AccountImportsList';
import { AccountReviewQueue } from '@/components/account/AccountReviewQueue';
import { ImportStatementDialog } from '@/components/account/ImportStatementDialog';
import { TransactionsList } from '@/components/transaction/TransactionsList';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { PageHeader } from '@/components/ui/PageHeader';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { Stat } from '@/components/ui/Stat';
import { Tabs } from '@/components/ui/Tabs';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useAccounts } from '@/lib/account/account-context';
import { displayLedgerCents, isCardOwed, isReconciled } from '@/lib/account/formatters';
import { INSTITUTION_META, type AccountImport, type AccountSummary } from '@/lib/account/types';
import { useGroups } from '@/lib/group/group-context';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { defaultFilters } from '@/lib/transaction/filters';
import { formatAmount, formatOccurredDate } from '@/lib/transaction/formatters';
import { useAsyncOperation } from '@/lib/ui';

type Tab = 'review' | 'transactions' | 'imports';
const TABS: Tab[] = ['review', 'transactions', 'imports'];

function isTab(v: string | null): v is Tab {
  return v !== null && (TABS as string[]).includes(v);
}

export function AccountDetailClient({ accountId }: { accountId: string }) {
  const t = useTranslations('accounts');
  const tDetail = useTranslations('accounts.detail');
  const tTokens = useTranslations('settings.tokens');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groups } = useGroups();
  const { getAccount, fetchImports } = useAccounts();

  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [tab, setTab] = useState<Tab | null>(
    isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : null,
  );
  const [importFilter, setImportFilter] = useState<string | null>(searchParams.get('import'));
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [imports, setImports] = useState<AccountImport[]>([]);
  const [importsCursor, setImportsCursor] = useState<string | null>(null);
  const [importsLoaded, setImportsLoaded] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  const detailOp = useAsyncOperation<AccountSummary>({
    scope: 'container',
    id: 'account-detail-fetch',
  });
  const importsOp = useAsyncOperation<{ data: AccountImport[]; nextCursor: string | null }>({
    scope: 'container',
    id: 'account-imports-fetch',
  });

  // ── Header ────────────────────────────────────────────────────────────────
  const loadAccount = useCallback(async () => {
    // An aborted run (StrictMode's double effect, a newer fetch) is not a failure.
    let aborted = false;
    const res = await detailOp.run((signal) => {
      signal.addEventListener('abort', () => (aborted = true));
      return getAccount(accountId, signal);
    });
    if (!res) {
      if (!aborted) setShowErrorDialog(true);
      return;
    }
    setAccount(res);
    // Default tab: review when something is pending, else transactions (spec §2).
    setTab((prev) => prev ?? (res.pendingLinesCount > 0 ? 'review' : 'transactions'));
    // detailOp / getAccount identities are stable.
  }, [accountId, getAccount]);
  const loadAccountRef = useRef(loadAccount);
  loadAccountRef.current = loadAccount;

  useEffect(() => {
    void loadAccountRef.current();
  }, [accountId]);
  useRealtimeEvents({ type: 'account.updated' }, (e) => {
    if (e.accountId === accountId) void loadAccountRef.current();
  });
  useRealtimeResync(() => void loadAccountRef.current());

  // ── URL sync ──────────────────────────────────────────────────────────────
  const writeUrl = useCallback(
    (nextTab: Tab, nextImport: string | null) => {
      const sp = new URLSearchParams();
      sp.set('tab', nextTab);
      if (nextImport) sp.set('import', nextImport);
      router.replace(`${pathname}?${sp.toString()}`);
    },
    [router, pathname],
  );
  const changeTab = (next: Tab) => {
    setTab(next);
    writeUrl(next, importFilter);
  };
  const selectImport = (id: string | null) => {
    setImportFilter(id);
    setTab('review');
    writeUrl('review', id);
  };

  // ── Imports tab ───────────────────────────────────────────────────────────
  const loadImports = useCallback(
    async (append: boolean) => {
      const res = await importsOp.run(async (signal) => {
        const r = await fetchImports(
          accountId,
          { limit: 25, cursor: append ? (importsCursor ?? undefined) : undefined },
          signal,
        );
        return { data: r.data, nextCursor: r.nextCursor };
      });
      if (!res) return;
      setImports((prev) => (append ? [...prev, ...res.data] : res.data));
      setImportsCursor(res.nextCursor);
      setImportsLoaded(true);
    },
    // importsOp identity is stable; the cursor is read at call time.
    [accountId, fetchImports, importsCursor],
  );
  const loadImportsRef = useRef(loadImports);
  loadImportsRef.current = loadImports;
  useEffect(() => {
    if (tab === 'imports') void loadImportsRef.current(false);
  }, [tab, accountId]);

  const refreshAll = () => {
    void loadAccountRef.current();
    if (tab === 'imports') void loadImportsRef.current(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const group =
    account?.scopeType === 'group' ? groups.find((g) => g.id === account.groupId) : undefined;
  const canManage =
    !!account &&
    (account.scopeType === 'personal' || (group?.role ?? '').toLowerCase() === 'admin');
  const institutionName = account?.institution
    ? INSTITUTION_META[account.institution as keyof typeof INSTITUTION_META]?.name
    : undefined;
  const gap = account?.reconciliationGapCents;
  const importButton = (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => setImportOpen(true)}
      data-testid="account-detail-import"
    >
      {t('import.title')}
    </Button>
  );

  return (
    <main
      id="main-content"
      className="container mx-auto max-w-4xl space-y-4 px-4 py-8"
      data-testid="account-detail-page"
    >
      {account ? (
        <>
          <PageHeader
            title={account.name}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="primary">{t(`kinds.${account.kind}`)}</Badge>
                {institutionName && <Badge tone="neutral">{institutionName}</Badge>}
                {account.last4 && (
                  <span dir="ltr" className="text-xs">
                    {t('card.last4', { digits: account.last4 })}
                  </span>
                )}
              </span>
            }
            actions={
              <>
                {importButton}
                {canManage && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditOpen(true)}
                    data-testid="account-detail-edit"
                  >
                    {tDetail('edit')}
                  </Button>
                )}
              </>
            }
            data-testid="account-detail-header"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label={isCardOwed(account) ? t('card.owed') : tDetail('ledger')}
              value={
                <span dir="ltr">
                  {formatAmount(displayLedgerCents(account), account.currency, locale)}
                </span>
              }
              hint={tDetail('asOf', { date: formatOccurredDate(account.ledgerBalanceAt, locale) })}
              valueTestId="account-detail-ledger"
            />
            {typeof account.reportedBalanceCents === 'number' && account.reportedBalanceAt && (
              <Stat
                label={tDetail('reported')}
                value={
                  <span dir="ltr">
                    {formatAmount(account.reportedBalanceCents, account.currency, locale)}
                  </span>
                }
                hint={tDetail('asOf', {
                  date: formatOccurredDate(account.reportedBalanceAt, locale),
                })}
                valueTestId="account-detail-reported"
              />
            )}
            {typeof gap === 'number' && (
              <Stat
                label={tDetail('gap')}
                tone={isReconciled(gap) ? 'positive' : 'negative'}
                value={
                  <span dir="ltr">
                    {isReconciled(gap)
                      ? tDetail('reconciled')
                      : formatAmount(gap, account.currency, locale)}
                  </span>
                }
                valueTestId="account-detail-gap"
              />
            )}
          </div>

          <div ref={tabsRef} tabIndex={-1}>
            <Tabs
              items={TABS.map((k) => ({
                key: k,
                label:
                  k === 'review' ? (
                    <span className="inline-flex items-center gap-1.5">
                      {tDetail('tabs.review')}
                      {account.pendingLinesCount > 0 && (
                        <Badge tone="warning" size="sm" data-testid="account-tab-review-count">
                          {account.pendingLinesCount}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    tDetail(`tabs.${k}`)
                  ),
              }))}
              current={tab ?? 'transactions'}
              onChange={(k) => changeTab(k as Tab)}
              ariaLabel={account.name}
              data-testid="account-tab"
            />
          </div>

          {tab === 'review' && (
            <>
              {importFilter && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone="primary" data-testid="account-review-import-chip">
                    {tDetail('importFilter', {
                      date: formatOccurredDate(
                        imports.find((i) => i.id === importFilter)?.createdAt ??
                          new Date().toISOString(),
                        locale,
                      ),
                    })}
                  </Badge>
                  <button
                    type="button"
                    className="text-xs text-primary-700 underline dark:text-primary-300"
                    onClick={() => selectImport(null)}
                  >
                    {tDetail('clearImportFilter')}
                  </button>
                </div>
              )}
              <AccountReviewQueue
                account={account}
                importId={importFilter ?? undefined}
                onChanged={() => void loadAccountRef.current()}
                onImportClick={() => setImportOpen(true)}
                escapeTargetRef={tabsRef}
              />
            </>
          )}

          {tab === 'transactions' && (
            <TransactionsList
              filters={{ ...defaultFilters('all'), accountId: account.id }}
              lockScope
              hide={{ account: true }}
              emptyState={tDetail('noTransactions')}
            />
          )}

          {tab === 'imports' && (
            <div className="relative">
              <AccountImportsList
                imports={imports}
                currency={account.currency}
                hasMore={!!importsCursor}
                loading={importsOp.isLoading && importsLoaded}
                onLoadMore={() => void loadImports(true)}
                onSelect={(id) => selectImport(id)}
                emptyAction={importButton}
              />
              <LoadingOverlay active={importsOp.isLoading && importsLoaded} />
              {/* 20.7 — the connector's entry point where the need for it
                  actually appears: after seeing what a manual import does. */}
              <p className="mt-3 text-sm">
                <Link
                  href="/settings/tokens"
                  className="text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  data-testid="account-imports-tokens-link"
                >
                  {tTokens('fromImports')}
                </Link>
              </p>
            </div>
          )}

          <ImportStatementDialog
            open={importOpen}
            account={account}
            onClose={() => setImportOpen(false)}
            onImported={refreshAll}
          />
          {editOpen && (
            <AccountFormDialog
              open
              mode="edit"
              account={account}
              onClose={() => setEditOpen(false)}
              onSaved={(saved) => {
                setAccount(saved);
                setEditOpen(false);
              }}
            />
          )}
        </>
      ) : (
        <div className="relative min-h-[12rem]">
          <LoadingOverlay active={detailOp.isLoading} />
        </div>
      )}

      <RetryReturnDialog
        open={showErrorDialog}
        reason={detailOp.error?.reason ?? 'unknown'}
        httpStatus={detailOp.error?.httpStatus}
        onRetry={() => {
          setShowErrorDialog(false);
          void loadAccountRef.current();
        }}
        onReturn={() => router.push('/accounts')}
      />
    </main>
  );
}
