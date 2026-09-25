'use client';

// Phase 6 · Iteration 6.15 — "This month" totals card on the aggregated
// dashboard. Aggregation is performed client-side over a single fetched page
// of transactions (cap 100). When the API reports `hasMore=true` we surface a
// "partial totals" badge — server-side rollups land in Phase 10.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeMonthRange } from './date-range';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Stat } from '@/components/ui/Stat';
import { useAuth } from '@/lib/auth/auth-context';
import { formatAmount } from '@/lib/transaction/formatters';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { TransactionSummary } from '@/lib/transaction/types';

export interface TotalsCardProps {
  /** ISO timestamp; defaults to first-of-this-month UTC midnight. */
  fromIso?: string;
  /** ISO timestamp; defaults to first-of-next-month UTC midnight. */
  toIso?: string;
  /**
   * When provided, the card renders directly from this list and skips the
   * fetch. Used by `<DashboardClient>` once it has cached the recent page,
   * so we don't issue a duplicate request.
   */
  transactions?: TransactionSummary[];
}

interface CurrencyTotals {
  currency: string;
  inCents: number;
  outCents: number;
}

const FETCH_LIMIT = 100;

function aggregate(rows: TransactionSummary[]): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>();
  for (const r of rows) {
    // Phase 20 §2.4 — a transfer moves money between the user's own accounts.
    // It is spending in neither direction, so it never enters a total.
    if (r.transferAccountId) continue;
    const cur = r.currency;
    const entry = map.get(cur) ?? { currency: cur, inCents: 0, outCents: 0 };
    if (r.direction === 'IN') entry.inCents += r.amountCents;
    else entry.outCents += r.amountCents;
    map.set(cur, entry);
  }
  return Array.from(map.values());
}

function sortCurrencies(rows: CurrencyTotals[], primary: string | undefined): CurrencyTotals[] {
  return [...rows].sort((a, b) => {
    if (a.currency === primary && b.currency !== primary) return -1;
    if (b.currency === primary && a.currency !== primary) return 1;
    return a.currency.localeCompare(b.currency);
  });
}

export function TotalsCard({ fromIso, toIso, transactions }: TotalsCardProps) {
  const t = useTranslations('dashboard.totals');
  const locale = useLocale();
  const { user } = useAuth();
  const { fetchList } = useTransactions();

  const range = useMemo(() => {
    if (fromIso && toIso) return { fromIso, toIso };
    const r = computeMonthRange();
    return { fromIso: fromIso ?? r.fromIso, toIso: toIso ?? r.toIso };
  }, [fromIso, toIso]);

  const externallyProvided = transactions !== undefined;

  const [rows, setRows] = useState<TransactionSummary[] | null>(
    externallyProvided ? transactions! : null,
  );
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(!externallyProvided);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchList({
        from: range.fromIso,
        to: range.toIso,
        limit: FETCH_LIMIT,
        sort: 'date_desc',
      });
      setRows(res.data);
      setHasMore(res.hasMore);
    } catch (e) {
      setError((e as Error).message || 'Failed to load totals');
    } finally {
      setLoading(false);
    }
  }, [fetchList, range.fromIso, range.toIso]);

  useEffect(() => {
    if (externallyProvided) {
      setRows(transactions!);
      setHasMore(false);
      return;
    }
    void load();
  }, [externallyProvided, transactions, load]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return sortCurrencies(aggregate(list), user?.defaultCurrency);
  }, [rows, user?.defaultCurrency]);

  return (
    <Card
      as="section"
      padding="sm"
      className="shadow-sm"
      data-testid="totals-card"
      aria-labelledby="totals-card-title"
    >
      <header className="mb-3 flex items-center justify-between">
        <h2
          id="totals-card-title"
          className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t('title')}
        </h2>
        {hasMore && (
          <Badge
            tone="warning"
            data-testid="totals-card-partial"
            title={t('partial', { count: FETCH_LIMIT })}
          >
            {t('partial', { count: FETCH_LIMIT })}
          </Badge>
        )}
      </header>

      {loading && (
        <div
          className="py-4 text-sm text-gray-500 dark:text-gray-400"
          role="status"
          aria-live="polite"
          data-testid="totals-card-loading"
        >
          {t('loading')}
        </div>
      )}

      {!loading && error && (
        <div
          className="flex items-center justify-between gap-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
          role="alert"
          data-testid="totals-card-error"
        >
          <span>{t('error', { message: error })}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            data-testid="totals-card-retry"
          >
            {t('retry')}
          </Button>
        </div>
      )}

      {!loading && !error && totals.length === 0 && (
        <EmptyState
          bordered={false}
          className="py-4 text-start"
          title={t('noActivity')}
          data-testid="totals-card-empty"
        />
      )}

      {!loading && !error && totals.length > 0 && (
        <ul className="space-y-2" data-testid="totals-card-rows">
          {totals.map((row) => {
            const net = row.inCents - row.outCents;
            return (
              <li
                key={row.currency}
                className="flex flex-wrap items-baseline gap-x-6 gap-y-1"
                data-testid={`totals-card-row-${row.currency}`}
              >
                <span className="min-w-[3rem] font-mono text-xs text-gray-500 dark:text-gray-400">
                  {row.currency}
                </span>
                <Stat
                  size="sm"
                  tone="positive"
                  label={t('in')}
                  value={formatAmount(row.inCents, row.currency, locale)}
                  valueTestId={`totals-card-in-${row.currency}`}
                />
                <Stat
                  size="sm"
                  tone="negative"
                  label={t('out')}
                  value={formatAmount(row.outCents, row.currency, locale)}
                  valueTestId={`totals-card-out-${row.currency}`}
                />
                <Stat
                  size="sm"
                  tone={net >= 0 ? 'neutral' : 'negative'}
                  label={t('net')}
                  value={formatAmount(net, row.currency, locale)}
                  valueTestId={`totals-card-net-${row.currency}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
