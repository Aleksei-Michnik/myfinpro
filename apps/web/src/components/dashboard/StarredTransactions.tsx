'use client';

// Phase 6 · Iteration 6.15 — "Starred" section on the dashboard.
// Reuses `<TransactionsList>` with `initialFilters.starred = true`. When a row is
// unstarred from this list, `<TransactionsList>` already removes it from the
// visible set (see TransactionsList.handleStarToggled).

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { TransactionsList } from '@/components/transaction/TransactionsList';
import { Link } from '@/i18n/navigation';
import { defaultFilters } from '@/lib/transaction/filters';

export interface StarredTransactionsProps {
  /** Optional cap. Defaults to 5. */
  limit?: number;
}

export function StarredTransactions({ limit = 5 }: StarredTransactionsProps) {
  const t = useTranslations('dashboard.starred');
  const filters = useMemo(() => ({ ...defaultFilters('all'), starred: true }), []);

  return (
    <section
      className="space-y-2"
      data-testid="starred-transactions"
      aria-labelledby="starred-transactions-title"
    >
      <header className="flex items-center justify-between">
        <h2
          id="starred-transactions-title"
          className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t('title')}
        </h2>
        <Link
          href="/transactions?starred=1"
          className="text-sm text-primary-600 hover:underline"
          data-testid="starred-transactions-view-all"
        >
          {t('viewAll')}
        </Link>
      </header>
      <TransactionsList
        showFilters={false}
        showControls={true}
        showStar={true}
        limit={limit}
        disableInternalAdd
        filters={filters}
        emptyState={<p>{t('empty')}</p>}
      />
    </section>
  );
}
