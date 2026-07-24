'use client';

// Phase 8.28 — receipt → transaction: pick an existing expense transaction to
// glue this standalone receipt to (the counterpart of confirm, which mints a
// NEW transaction). Candidates are receiptless OUT transactions the caller
// created — exactly the server-side link guard. The parent routes on success:
// a REVIEW receipt continues to reconcile, a CONFIRMED one is done.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect } from 'react';
import { LinkPickerDialog } from '@/components/receipt/LinkPickerDialog';
import { useToast } from '@/components/ui/Toast';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { formatAmount, formatOccurredDate } from '@/lib/transaction/formatters';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { TransactionSummary } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface LinkTransactionDialogProps {
  open: boolean;
  receiptId: string;
  locale: string;
  onClose(): void;
  /** The now-linked receipt — the parent refreshes / routes by its status. */
  onLinked(receipt: ReceiptSummary): void;
}

export function LinkTransactionDialog({
  open,
  receiptId,
  locale,
  onClose,
  onLinked,
}: LinkTransactionDialogProps) {
  const t = useTranslations('receipts.link');
  const { fetchList } = useTransactions();
  const { linkToTransaction } = useReceipts();
  const { addToast } = useToast();
  const op = useAsyncOperation<ReceiptSummary>({ scope: 'control' });

  const fetchCandidates = useCallback(
    async (search: string, signal: AbortSignal): Promise<TransactionSummary[]> => {
      const page = await fetchList(
        {
          direction: 'OUT',
          hasReceipt: false,
          createdByMe: true,
          withParent: true,
          sort: 'date_desc',
          limit: 20,
          ...(search ? { search } : {}),
        },
        signal,
      );
      return page.data;
    },
    [fetchList],
  );

  const onSelect = (transaction: TransactionSummary) => {
    void op
      .run((signal) => linkToTransaction(receiptId, transaction.id, signal))
      .then((receipt) => {
        if (receipt !== undefined) onLinked(receipt);
      });
  };

  // Link failures surface as a toast; aborts stay silent (useAsyncOperation contract).
  useEffect(() => {
    if (op.error && op.error.reason !== 'aborted')
      addToast('error', op.error.message || t('failed'));
  }, [op.error, addToast, t]);

  return (
    <LinkPickerDialog<TransactionSummary>
      open={open}
      title={t('toTransactionTitle')}
      hint={t('toTransactionHint')}
      searchLabel={t('searchTransactions')}
      searchPlaceholder={t('searchTransactionsPlaceholder')}
      emptyLabel={t('noTransactions')}
      loadingLabel={t('loading')}
      closeLabel={t('close')}
      fetchCandidates={fetchCandidates}
      getKey={(tx) => tx.id}
      renderRow={(tx) => (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {tx.note || tx.categories[0].name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatOccurredDate(tx.occurredAt, locale)}
            </p>
          </div>
          <span className="shrink-0 font-mono text-sm text-gray-900 dark:text-gray-100">
            {formatAmount(tx.amountCents, tx.currency, locale)}
          </span>
        </div>
      )}
      onSelect={onSelect}
      busy={op.isLoading}
      onClose={onClose}
      testIdPrefix="link-transaction"
    />
  );
}
