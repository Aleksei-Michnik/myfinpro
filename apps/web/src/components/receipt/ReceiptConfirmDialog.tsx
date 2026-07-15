'use client';

// Phase 7 · Iteration 7.9 — confirm dialog for a reviewed receipt. Collects
// the resulting transaction's primary OUT category and its attribution scopes
// (last-used remembered via remember.ts, mirroring the transaction form), then
// POSTs /receipts/:id/confirm. On success the caller navigates to the new
// transaction. Portal-mounted, ESC + backdrop close.

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TransactionCategoryPicker } from '@/components/transaction/TransactionCategoryPicker';
import { TransactionScopeSelector } from '@/components/transaction/TransactionScopeSelector';
import { Button } from '@/components/ui/Button';
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
  onCancel(): void;
  /** Fired with the new transaction id once confirmation succeeds. */
  onConfirmed(transactionId: string): void;
}

export function ReceiptConfirmDialog({
  open,
  receiptId,
  categories,
  defaultCategoryId,
  onCancel,
  onConfirmed,
}: ReceiptConfirmDialogProps) {
  const t = useTranslations('receipts.confirm');
  const { confirmReceipt } = useReceipts();
  const { addToast } = useToast();

  const [categoryId, setCategoryId] = useState<string | null>(defaultCategoryId ?? null);
  const [scopes, setScopes] = useState<AttributionScope[]>([{ scope: 'personal' }]);
  const [note, setNote] = useState('');

  const confirmOp = useAsyncOperation<string>({ scope: 'control' });
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset the form each time the dialog opens; seed scopes from last-used.
  useEffect(() => {
    if (!open) return;
    setCategoryId(defaultCategoryId ?? null);
    setScopes(getLastUsedScopes());
    setNote('');
  }, [open, defaultCategoryId]);

  // ESC to cancel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

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
          { categoryId, attributions: scopes, note: note.trim() || undefined },
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

  const node = (
    <div
      data-testid="receipt-confirm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-confirm-title"
        data-testid="receipt-confirm-dialog"
        className="w-full max-w-md space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
      >
        <div>
          <h2
            id="receipt-confirm-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t('title')}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('description')}</p>
        </div>

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

        <div className="space-y-1">
          <label
            htmlFor="receipt-confirm-note"
            className="text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            {t('noteLabel')}
          </label>
          <textarea
            id="receipt-confirm-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            rows={2}
            data-testid="receipt-confirm-note"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
