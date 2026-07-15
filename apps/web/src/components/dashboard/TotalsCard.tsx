'use client';

// Phase 6 · Iteration 6.15 — "This month" totals card on the aggregated
// dashboard. Aggregation is performed client-side over a single fetched page
// of transactions (cap 100). When the API reports `hasMore=true` we surface a
// "partial totals" badge — server-side rollups land in Phase 10.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeMonthRange } from './date-range';
import { Button } from '@/components/ui/Button';
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
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
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
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            data-testid="totals-card-partial"
            title={t('partial', { count: FETCH_LIMIT })}
          >
            {t('partial', { count: FETCH_LIMIT })}
          </span>
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
        <p
          className="py-4 text-sm text-gray-500 dark:text-gray-400"
          data-testid="totals-card-empty"
        >
          {t('noActivity')}
        </p>
      )}

      {!loading && !error && totals.length > 0 && (
        <ul className="space-y-2" data-testid="totals-card-rows">
          {totals.map((row) => {
            const net = row.inCents - row.outCents;
            return (
              <li
                key={row.currency}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
                data-testid={`totals-card-row-${row.currency}`}
              >
                <span className="min-w-[3rem] font-mono text-xs text-gray-500 dark:text-gray-400">
                  {row.currency}
                </span>
                <span className="text-green-700 dark:text-green-400">
                  {t('in')}{' '}
                  <span data-testid={`totals-card-in-${row.currency}`}>
                    {formatAmount(row.inCents, row.currency, locale)}
                  </span>
                </span>
                <span className="text-red-700 dark:text-red-400">
                  {t('out')}{' '}
                  <span data-testid={`totals-card-out-${row.currency}`}>
                    {formatAmount(row.outCents, row.currency, locale)}
                  </span>
                </span>
                <span
                  className={
                    net >= 0
                      ? 'font-medium text-gray-900 dark:text-gray-100'
                      : 'font-medium text-red-700 dark:text-red-400'
                  }
                >
                  {t('net')}{' '}
                  <span data-testid={`totals-card-net-${row.currency}`}>
                    {formatAmount(net, row.currency, locale)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
