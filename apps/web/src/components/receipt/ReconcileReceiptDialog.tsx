'use client';

// Phase 8 · Iteration 8.15 — reconcile an attached receipt with its transaction
// (design §3). When a receipt attached to an existing transaction finishes
// extraction, this compares the transaction's current total and category against
// what the receipt analysis found. For each field that differs the user
// keeps the current value or takes the receipt's; item/product links are
// saved regardless (that happened during review). Submitting confirms the
// receipt (REVIEW → CONFIRMED) without creating a new transaction.
//
// Accessibility: dialog semantics, focus moved in on open, Esc/backdrop
// close, each choice is a labelled radio group; dark-mode variants throughout.

import { dominantReceiptCategoryId } from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { formatAmount } from '@/lib/transaction/formatters';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { CategoryDto, TransactionSummary } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface ReconcileReceiptDialogProps {
  open: boolean;
  receipt: ReceiptSummary;
  categories: CategoryDto[];
  onCancel(): void;
  /** The receipt is now CONFIRMED and reconciled — the parent routes to the transaction. */
  onReconciled(transactionId: string): void;
}

/** One reconciliation field: current value vs. the receipt's, and the choice. */
function ChoiceRow({
  label,
  current,
  proposed,
  apply,
  onChange,
  name,
}: {
  label: string;
  current: string;
  proposed: string;
  apply: boolean;
  onChange(apply: boolean): void;
  name: string;
}) {
  const t = useTranslations('receipts.reconcile');
  return (
    <fieldset
      className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
      data-testid={`reconcile-field-${name}`}
    >
      <legend className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</legend>
      <div className="mt-1 space-y-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
          <input
            type="radio"
            name={name}
            checked={!apply}
            onChange={() => onChange(false)}
            data-testid={`reconcile-${name}-keep`}
            className="text-primary-600 focus:ring-primary-500"
          />
          <span>
            {t('keep')} <span className="font-medium">{current}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
          <input
            type="radio"
            name={name}
            checked={apply}
            onChange={() => onChange(true)}
            data-testid={`reconcile-${name}-update`}
            className="text-primary-600 focus:ring-primary-500"
          />
          <span>
            {t('update')} <span className="font-medium">{proposed}</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

export function ReconcileReceiptDialog({
  open,
  receipt,
  categories,
  onCancel,
  onReconciled,
}: ReconcileReceiptDialogProps) {
  const t = useTranslations('receipts.reconcile');
  const locale = useLocale();
  const { getTransaction } = useTransactions();
  const { reconcileReceipt } = useReceipts();
  const { addToast } = useToast();

  const [transaction, setTransaction] = useState<TransactionSummary | null>(null);
  const [applyTotal, setApplyTotal] = useState(false);
  const [applyCategory, setApplyCategory] = useState(false);

  const loadOp = useAsyncOperation<TransactionSummary>({ scope: 'control' });
  const submitOp = useAsyncOperation<ReceiptSummary>({ scope: 'control' });

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : t('none'));
  }, [categories, t]);

  const receiptCategoryId = useMemo(
    () =>
      dominantReceiptCategoryId(
        receipt.items.map((i) => ({ categoryId: i.categoryId, totalCents: i.totalCents })),
      ),
    [receipt.items],
  );

  // Load the transaction once per open so we can compare against it.
  useEffect(() => {
    if (!open || !receipt.transactionId) return;
    setApplyTotal(false);
    setApplyCategory(false);
    void loadOp
      .run((signal) => getTransaction(receipt.transactionId as string, signal))
      .then((p) => {
        if (p === undefined) return;
        setTransaction(p);
        // Default each differing field to "take the receipt" — the user
        // attached it precisely to update the transaction.
        const totalDiffers =
          receipt.totalCents !== null &&
          (receipt.totalCents !== p.amountCents ||
            (!!receipt.currency && receipt.currency !== p.currency));
        // Multi-category: reconcile compares against the PRIMARY category.
        const catDiffers = !!receiptCategoryId && receiptCategoryId !== p.categories[0].id;
        setApplyTotal(totalDiffers);
        setApplyCategory(catDiffers);
      });
    // Deliberately keyed on open (+ the transaction link) alone — re-loading on
    // every receipt/category change would clobber the user's in-progress
    // radio choices.
  }, [open, receipt.transactionId]);

  useEffect(() => {
    if (submitOp.error && submitOp.error.reason !== 'aborted') {
      addToast('error', submitOp.error.message || t('failed'));
    }
  }, [submitOp.error, addToast, t]);

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

  const totalDiffers =
    !!transaction &&
    receipt.totalCents !== null &&
    (receipt.totalCents !== transaction.amountCents ||
      (!!receipt.currency && receipt.currency !== transaction.currency));
  const categoryDiffers =
    !!transaction && !!receiptCategoryId && receiptCategoryId !== transaction.categories[0].id;

  const submit = () => {
    void submitOp
      .run((signal) => reconcileReceipt(receipt.id, { applyTotal, applyCategory }, signal))
      .then((fresh) => {
        if (fresh !== undefined && receipt.transactionId) onReconciled(receipt.transactionId);
      });
  };

  if (!open || typeof document === 'undefined') return null;

  return (
    <Dialog
      open
      onClose={onCancel}
      variant="sheet"
      title={t('title')}
      titleId="reconcile-title"
      testId="reconcile-dialog"
      backdropTestId="reconcile-backdrop"
      closeTestId="reconcile-close"
    >
      {loadOp.isLoading && !transaction ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('loading')}</p>
      ) : !transaction ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('loadFailed')}
        </p>
      ) : (
        <>
          {!totalDiffers && !categoryDiffers ? (
            <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="reconcile-match">
              {t('noDifferences')}
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('hint')}</p>
              {totalDiffers && (
                <ChoiceRow
                  name="total"
                  label={t('totalLabel')}
                  current={formatAmount(transaction.amountCents, transaction.currency, locale)}
                  proposed={formatAmount(
                    receipt.totalCents as number,
                    receipt.currency ?? transaction.currency,
                    locale,
                  )}
                  apply={applyTotal}
                  onChange={setApplyTotal}
                />
              )}
              {categoryDiffers && (
                <ChoiceRow
                  name="category"
                  label={t('categoryLabel')}
                  current={categoryName(transaction.categories[0].id)}
                  proposed={categoryName(receiptCategoryId)}
                  apply={applyCategory}
                  onChange={setApplyCategory}
                />
              )}
            </>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500">{t('itemsNote')}</p>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={submitOp.isLoading}
              data-testid="reconcile-submit"
            >
              {submitOp.isLoading ? <ButtonSpinner /> : null}
              {t('confirm')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
