'use client';

// Phase 7 · Iteration 7.7 — lifecycle status pill for receipt rows.

import { useTranslations } from 'next-intl';
import type { ReceiptStatus } from '@/lib/receipt/types';

const PILL_CLASSES: Record<ReceiptStatus, string> = {
  UPLOADED:
    'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600',
  EXTRACTING:
    'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800',
  REVIEW:
    'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800',
  CONFIRMED:
    'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800',
  FAILED:
    'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800',
};

export function ReceiptStatusPill({ status }: { status: ReceiptStatus }) {
  const t = useTranslations('receipts.status');
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${PILL_CLASSES[status]}`}
      data-testid="receipt-status-pill"
      data-status={status}
    >
      {status === 'EXTRACTING' && (
        <span
          aria-hidden="true"
          className="h-2 w-2 animate-pulse rounded-full bg-blue-500 dark:bg-blue-300"
        />
      )}
      {t(status)}
    </span>
  );
}
