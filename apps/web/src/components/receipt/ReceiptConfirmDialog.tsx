'use client';

// Phase 7 · Iteration 7.9 — confirm dialog for a reviewed receipt. Collects
// the resulting transaction's primary OUT category and its attribution scopes
// (last-used remembered via remember.ts, mirroring the transaction form), then
// POSTs /receipts/:id/confirm. On success the caller navigates to the new
// transaction. Portal-mounted, ESC + backdrop close.

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AccountSelect } from '@/components/account/AccountSelect';
import { TransactionCategoryPicker } from '@/components/transaction/TransactionCategoryPicker';
import { TransactionScopeSelector } from '@/components/transaction/TransactionScopeSelector';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { useReceipts } from '@/lib/receipt/receipt-context';
import { getLastUsedScopes, setLastUsedScopes } from '@/lib/transaction/remember';
import type { AttributionScope, CategoryDto } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface ReceiptConfirmDialogProps {
  open: boolean;
  receiptId: string;
  /** OUT categories already loaded by the review page (avoids a refetch). */
  categories: CategoryDto[];
  /** Pre-selected primary category (e.g. the most common line-item category). */
  defaultCategoryId?: string | null;
  /** The receipt's currency — narrows the account picker (20.6). */
  currency?: string | null;
  onCancel(): void;
  /** Fired with the new transaction id once confirmation succeeds. */
  onConfirmed(transactionId: string): void;
}

export function ReceiptConfirmDialog({
  open,
  receiptId,
  categories,
  defaultCategoryId,
  currency,
  onCancel,
  onConfirmed,
}: ReceiptConfirmDialogProps) {
  const t = useTranslations('receipts.confirm');
  const { confirmReceipt } = useReceipts();
  const { addToast } = useToast();

  const [categoryId, setCategoryId] = useState<string | null>(defaultCategoryId ?? null);
  const [scopes, setScopes] = useState<AttributionScope[]>([{ scope: 'personal' }]);
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);

  const confirmOp = useAsyncOperation<string>({ scope: 'control' });

  // Reset the form each time the dialog opens; seed scopes from last-used.
  useEffect(() => {
    if (!open) return;
    setCategoryId(defaultCategoryId ?? null);
    setScopes(getLastUsedScopes());
    setNote('');
    setAccountId(null);
  }, [open, defaultCategoryId]);

  useEffect(() => {
    if (confirmOp.error && confirmOp.error.reason !== 'aborted') {
      addToast('error', confirmOp.error.message || t('confirmFailed'));
    }
  }, [confirmOp.error, addToast, t]);

  const submit = () => {
    if (!categoryId) {
      addToast('error', t('missingCategory'));
      return;
    }
    if (scopes.length === 0) {
      addToast('error', t('missingScope'));
      return;
    }
    void confirmOp
      .run(async (signal) => {
        const fresh = await confirmReceipt(
          receiptId,
          {
            categoryId,
            attributions: scopes,
            note: note.trim() || undefined,
            accountId: accountId ?? undefined,
          },
          signal,
        );
        if (!fresh.transactionId) throw new Error('Confirmation returned no transaction');
        return fresh.transactionId;
      })
      .then((transactionId) => {
        if (transactionId !== undefined) {
          setLastUsedScopes(scopes);
          addToast('success', t('confirmedToast'));
          onConfirmed(transactionId);
        }
      });
  };

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('title')}
      titleId="receipt-confirm-title"
      testId="receipt-confirm-dialog"
      backdropTestId="receipt-confirm-backdrop"
      className="space-y-4"
      headerClassName="mb-1"
    >
      <p className="text-sm text-gray-600 dark:text-gray-400">{t('description')}</p>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('categoryLabel')}
        </label>
        <TransactionCategoryPicker
          direction="OUT"
          value={categoryId}
          onChange={setCategoryId}
          categories={categories}
          testId="receipt-confirm-category"
        />
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('scopeLabel')}
        </span>
        <TransactionScopeSelector value={scopes} onChange={setScopes} />
      </div>

      {/* Phase 20.6 — an account placement lets the bank line find this receipt. */}
      <AccountSelect
        label={t('accountLabel')}
        value={accountId}
        onChange={setAccountId}
        currency={currency ?? undefined}
        testId="receipt-confirm-account"
      />

      <div className="space-y-1">
        <label
          htmlFor="receipt-confirm-note"
          className="text-xs font-medium text-gray-500 dark:text-gray-400"
        >
          {t('noteLabel')}
        </label>
        <Textarea
          id="receipt-confirm-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          rows={2}
          data-testid="receipt-confirm-note"
          size="sm"
          wrapperClassName="contents"
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onCancel}
          disabled={confirmOp.isLoading}
          data-testid="receipt-confirm-cancel"
        >
          {t('cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={submit}
          disabled={confirmOp.isLoading}
          data-testid="receipt-confirm-submit"
        >
          {t('submit')}
        </Button>
      </div>
    </Dialog>
  );
}
