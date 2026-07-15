'use client';

// Phase 6 · Iteration 6.16 — group dashboard transactions section.
// Reuses <TransactionsList> scoped to the current group with locked scope.

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { TransactionsList } from '@/components/transaction/TransactionsList';
import { defaultFilters } from '@/lib/transaction/filters';

export interface GroupTransactionsTabProps {
  groupId: string;
}

export function GroupTransactionsTab({ groupId }: GroupTransactionsTabProps) {
  const t = useTranslations('transactions.page');
  const filters = useMemo(() => defaultFilters(`group:${groupId}`), [groupId]);
  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
      data-testid="group-transactions-tab"
      aria-labelledby="group-transactions-title"
    >
      <h2
        id="group-transactions-title"
        className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        {t('groupTabTitle')}
      </h2>
      <TransactionsList filters={filters} lockScope showFilters showControls showStar />
    </section>
  );
}
