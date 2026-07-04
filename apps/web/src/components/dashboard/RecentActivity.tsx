'use client';

// Phase 6 · Iteration 6.15 — "Recent activity" section on the dashboard.
// Thin wrapper around `<PaymentsList>` with the inline add button suppressed
// (the dashboard provides its own primary `<QuickAddPaymentButton>`).

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { PaymentsList } from '@/components/payment/PaymentsList';
import { Link } from '@/i18n/navigation';
import { defaultFilters } from '@/lib/payment/filters';

export interface RecentActivityProps {
  /** Optional cap. Defaults to 10. */
  limit?: number;
}

export function RecentActivity({ limit = 10 }: RecentActivityProps) {
  const t = useTranslations('dashboard.recent');
  const filters = useMemo(() => defaultFilters('all'), []);

  return (
    <section
      className="space-y-2"
      data-testid="recent-activity"
      aria-labelledby="recent-activity-title"
    >
      <header className="flex items-center justify-between">
        <h2
          id="recent-activity-title"
          className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          {t('title')}
        </h2>
        <Link
          href="/payments"
          className="text-sm text-primary-600 hover:underline"
          data-testid="recent-activity-view-all"
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
        filters={filters}
        emptyState={<p>{t('empty')}</p>}
      />
    </section>
  );
}
