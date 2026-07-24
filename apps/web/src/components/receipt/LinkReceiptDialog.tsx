'use client';

// Phase 8.28 — transaction → receipt: pick an existing standalone receipt to
// glue to this transaction (the counterpart of 8.15 attach, which uploads a NEW
// receipt). Candidates are the caller's unattached REVIEW/CONFIRMED receipts.
// On success the parent routes: a REVIEW receipt continues to reconcile, a
// CONFIRMED one just shows up on the transaction.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect } from 'react';
import { LinkPickerDialog } from '@/components/receipt/LinkPickerDialog';
import { ReceiptStatusPill } from '@/components/receipt/ReceiptStatusPill';
import { useToast } from '@/components/ui/Toast';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { formatAmount, formatOccurredDate } from '@/lib/transaction/formatters';
import { useAsyncOperation } from '@/lib/ui';

export interface LinkReceiptDialogProps {
  open: boolean;
  transactionId: string;
  locale: string;
  onClose(): void;
  /** The now-linked receipt — the parent routes / refetches by its status. */
  onLinked(receipt: ReceiptSummary): void;
}

function receiptTitle(r: ReceiptSummary, fallback: string): string {
  return r.merchantName ?? r.extractedMerchantName ?? r.originalName ?? r.sourceUrl ?? fallback;
}

export function LinkReceiptDialog({
  open,
  transactionId,
  locale,
  onClose,
  onLinked,
}: LinkReceiptDialogProps) {
  const t = useTranslations('receipts.link');
  const { fetchList, linkToTransaction } = useReceipts();
  const { addToast } = useToast();
  const op = useAsyncOperation<ReceiptSummary>({ scope: 'control' });

  const fetchCandidates = useCallback(
    async (_search: string, signal: AbortSignal): Promise<ReceiptSummary[]> => {
      const page = await fetchList({ linkable: true, limit: 20 }, signal);
      return page.data;
    },
    [fetchList],
  );

  const onSelect = (receipt: ReceiptSummary) => {
    void op
      .run((signal) => linkToTransaction(receipt.id, transactionId, signal))
      .then((linked) => {
        if (linked !== undefined) onLinked(linked);
      });
  };

  useEffect(() => {
    if (op.error && op.error.reason !== 'aborted')
      addToast('error', op.error.message || t('failed'));
  }, [op.error, addToast, t]);

  return (
    <LinkPickerDialog<ReceiptSummary>
      open={open}
      title={t('toReceiptTitle')}
      hint={t('toReceiptHint')}
      searchLabel={t('searchReceipts')}
      searchPlaceholder=""
      emptyLabel={t('noReceipts')}
      loadingLabel={t('loading')}
      closeLabel={t('close')}
      searchable={false}
      fetchCandidates={fetchCandidates}
      getKey={(r) => r.id}
      renderRow={(r) => (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {receiptTitle(r, t('untitledReceipt'))}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatOccurredDate(r.purchasedAt ?? r.createdAt, locale)}
              {r.totalCents !== null && r.currency
                ? ` · ${formatAmount(r.totalCents, r.currency, locale)}`
                : ''}
            </p>
          </div>
          <ReceiptStatusPill status={r.status} />
        </div>
      )}
      onSelect={onSelect}
      busy={op.isLoading}
      onClose={onClose}
      testIdPrefix="link-receipt"
    />
  );
}
