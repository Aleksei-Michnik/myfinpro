'use client';

// Phase 20 · Iteration 20.3 — the accounts widget on the dashboard (UI spec
// §6): net position per currency, one compact row per account, and a nudge
// when statement lines are waiting. Widget-local async (container scope,
// inline banner on failure — never a dialog); re-mounted by the dashboard's
// `refreshKey` like its siblings, and refetched on `account.updated`.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { Stat } from '@/components/ui/Stat';
import { Link } from '@/i18n/navigation';
import { useAccounts } from '@/lib/account/account-context';
import { displayLedgerCents, isCardOwed } from '@/lib/account/formatters';
import type { AccountSummary } from '@/lib/account/types';
import { useAuth } from '@/lib/auth/auth-context';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { formatAmount } from '@/lib/transaction/formatters';
import { useAsyncOperation } from '@/lib/ui';

interface NetPosition {
  currency: string;
  cents: number;
}

/** Σ ledger balances per currency, the user's default currency first. */
export function netPositions(accounts: AccountSummary[], primary?: string): NetPosition[] {
  const map = new Map<string, number>();
  for (const a of accounts) map.set(a.currency, (map.get(a.currency) ?? 0) + a.ledgerBalanceCents);
  return [...map.entries()]
    .map(([currency, cents]) => ({ currency, cents }))
    .sort((a, b) => {
      if (a.currency === primary && b.currency !== primary) return -1;
      if (b.currency === primary && a.currency !== primary) return 1;
      return a.currency.localeCompare(b.currency);
    });
}

export interface AccountsOverviewProps {
  /** Opens the create-account dialog (empty state action). */
  onNewAccount?(): void;
}

export function AccountsOverview({ onNewAccount }: AccountsOverviewProps) {
  const t = useTranslations('accounts.overview');
  const tList = useTranslations('accounts.list');
  const tKinds = useTranslations('accounts.kinds');
  const tCard = useTranslations('accounts.card');
  const locale = useLocale();
  const { user } = useAuth();
  const { fetchAccounts } = useAccounts();

  const op = useAsyncOperation<AccountSummary[]>({
    scope: 'container',
    id: 'dashboard-accounts-fetch',
  });

  const load = useCallback(() => {
    void op.run(async (signal) => {
      const res = await fetchAccounts({ scope: 'all', limit: 100 }, signal);
      return res.data;
    });
    // op identity is stable across renders.
  }, [fetchAccounts]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtimeEvents({ type: 'account.updated' }, load);

  const accounts = op.data ?? null;
  const positions = useMemo(
    () => (accounts ? netPositions(accounts, user?.defaultCurrency) : []),
    [accounts, user?.defaultCurrency],
  );
  const pending = useMemo(
    () => (accounts ?? []).filter((a) => a.pendingLinesCount > 0),
    [accounts],
  );

  return (
    <Card as="section" aria-labelledby="accounts-overview-title" data-testid="accounts-overview">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id="accounts-overview-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t('title')}
        </h2>
        <Link
          href="/accounts"
          className="text-sm text-primary-700 hover:underline dark:text-primary-300"
          data-testid="accounts-overview-manage"
        >
          {t('manage')}
        </Link>
      </div>

      {op.isLoading && accounts === null ? (
        <div
          className="h-16 animate-pulse rounded-md bg-gray-100 motion-reduce:animate-none dark:bg-gray-700"
          role="status"
          aria-label={t('loading')}
          data-testid="accounts-overview-loading"
        />
      ) : op.isError && op.error && op.error.reason !== 'aborted' ? (
        <div data-testid="accounts-overview-error">
          <InlineErrorBanner
            reason={op.error.reason}
            httpStatus={op.error.httpStatus}
            message={t('errorLoading')}
            onRetry={() => void op.retry()}
            retrying={op.isLoading}
          />
        </div>
      ) : accounts && accounts.length === 0 ? (
        <EmptyState
          bordered={false}
          data-testid="accounts-overview-empty"
          title={t('empty')}
          action={
            onNewAccount ? (
              <Button type="button" variant="outline" size="sm" onClick={onNewAccount}>
                {tList('newAccount')}
              </Button>
            ) : undefined
          }
        />
      ) : accounts ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 sm:gap-6">
            {positions.map((p) => (
              <Stat
                key={p.currency}
                size="sm"
                label={`${t('net')} · ${p.currency}`}
                value={
                  <span className="font-mono" data-testid={`accounts-overview-net-${p.currency}`}>
                    {formatAmount(p.cents, p.currency, locale)}
                  </span>
                }
                tone={p.cents < 0 ? 'negative' : 'neutral'}
              />
            ))}
          </div>

          <ul
            className="divide-y divide-gray-100 dark:divide-gray-700"
            data-testid="accounts-overview-rows"
          >
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 py-1.5 text-sm"
                data-testid={`accounts-overview-row-${a.id}`}
              >
                <Link
                  href={`/accounts/${a.id}`}
                  className="min-w-0 flex-1 truncate text-gray-900 hover:underline dark:text-gray-100"
                >
                  {a.name}
                </Link>
                <Badge tone="neutral" size="sm">
                  {tKinds(a.kind)}
                </Badge>
                {isCardOwed(a) && (
                  <Badge tone="warning" size="sm">
                    {tCard('owed')}
                  </Badge>
                )}
                <span className="font-mono text-end text-gray-900 dark:text-gray-100">
                  {formatAmount(displayLedgerCents(a), a.currency, locale)}
                </span>
              </li>
            ))}
          </ul>

          {pending.map((a) => (
            <Link
              key={a.id}
              href={`/accounts/${a.id}?tab=review`}
              className="block text-sm text-amber-700 hover:underline dark:text-amber-300"
              data-testid={`accounts-overview-pending-${a.id}`}
            >
              {a.name} ·{' '}
              {a.reconciliationGapCents
                ? t('pendingGap', {
                    count: a.pendingLinesCount,
                    amount: formatAmount(a.reconciliationGapCents, a.currency, locale),
                  })
                : t('pending', { count: a.pendingLinesCount })}
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
