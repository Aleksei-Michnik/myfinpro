'use client';

// Phase 6 · Iteration 6.14 — placeholder for the documents/attachments panel.
// Replaced with a real implementation in Phase 9.

import { useTranslations } from 'next-intl';

export function PaymentDocumentsPlaceholder() {
  const t = useTranslations('payments.documents');
  return (
    <section
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 dark:border-gray-600 dark:bg-gray-900/40"
      aria-labelledby="payment-documents-title"
      data-testid="payment-documents-placeholder"
    >
      <h2
        id="payment-documents-title"
        className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
      >
        {t('title')}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">{t('comingSoon')}</p>
    </section>
  );
}
