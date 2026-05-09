'use client';

// Phase 6 · Iteration 6.15 — "Starred" section on the dashboard.
// Reuses `<PaymentsList>` with `initialFilters.starred = true`. When a row is
// unstarred from this list, `<PaymentsList>` already removes it from the
// visible set (see PaymentsList.handleStarToggled).

import { useTranslations } from 'next-intl';
import { PaymentsList } from '@/components/payment/PaymentsList';
import { Link } from '@/i18n/navigation';

export interface StarredPaymentsProps {
  /** Optional cap. Defaults to 5. */
  limit?: number;
}

export function StarredPayments({ limit = 5 }: StarredPaymentsProps) {
  const t = useTranslations('dashboard.starred');

  return (
    <section
      className="space-y-2"
      data-testid="starred-payments"
      aria-labelledby="starred-payments-title"
    >
      <header className="flex items-center justify-between">
        <h2
          id="starred-payments-title"
          className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t('title')}
        </h2>
        <Link
          href="/payments/starred"
          className="text-sm text-primary-600 hover:underline"
          data-testid="starred-payments-view-all"
        >
          {t('viewAll')}
        </Link>
      </header>
      <PaymentsList
        showFilters={false}
        showControls={true}
        showStar={true}
        limit={limit}
        disableInternalAdd
        initialFilters={{ starred: true, sort: 'date_desc' }}
        emptyState={<p>{t('empty')}</p>}
      />
    </section>
  );
}
