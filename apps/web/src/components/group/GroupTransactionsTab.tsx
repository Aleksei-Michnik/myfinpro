'use client';

// Phase 6 · Iteration 6.16 — group dashboard payments section.
// Reuses <PaymentsList> scoped to the current group with locked scope.

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { PaymentsList } from '@/components/payment/PaymentsList';
import { defaultFilters } from '@/lib/payment/filters';

export interface GroupPaymentsTabProps {
  groupId: string;
}

export function GroupPaymentsTab({ groupId }: GroupPaymentsTabProps) {
  const t = useTranslations('payments.page');
  const filters = useMemo(() => defaultFilters(`group:${groupId}`), [groupId]);
  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
      data-testid="group-payments-tab"
      aria-labelledby="group-payments-title"
    >
      <h2
        id="group-payments-title"
        className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        {t('groupTabTitle')}
      </h2>
      <PaymentsList filters={filters} lockScope showFilters showControls showStar />
    </section>
  );
}
