'use client';

// Phase 6 · Iteration 6.14 — placeholder for schedule/plan section.
// Shown only for non-ONE_TIME / child occurrences. 6.18 and 6.20 will
// replace this with <TransactionScheduleSummary> / <TransactionPlanTable>.

import { useTranslations } from 'next-intl';

export function TransactionSchedulePlanPlaceholder() {
  const t = useTranslations('transactions.schedulePlan');
  return (
    <section
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 dark:border-gray-600 dark:bg-gray-900/40"
      aria-labelledby="transaction-schedule-plan-title"
      data-testid="transaction-schedule-plan-placeholder"
    >
      <h2
        id="transaction-schedule-plan-title"
        className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
      >
        {t('occurrenceTitle')}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">{t('comingSoon')}</p>
    </section>
  );
}
