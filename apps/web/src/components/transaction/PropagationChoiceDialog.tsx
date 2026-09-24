'use client';

// Phase 6 · Iteration 6.18.1.5 — propagation choice dialog.
//
// Shown when a user edits a RECURRING parent transaction's non-period fields and
// the parent has ≥1 child occurrence. The user picks how far the change
// reaches (self / future / all); the backend applies it transactionally.
//
// The async submit is owned by the caller (<TransactionFormDialog>'s saveOp), so
// this component is purely presentational: it surfaces the three modes and
// reports the chosen one via onConfirm. The `pending` prop drives the confirm
// button's spinner / disabled state.
//
// `destructive` is a forward-looking prop: in 6.18.1.5.2, when period changes
// can regenerate (wipe) children, the dialog will render a data-loss warning
// block. For non-period edits (this iteration) it stays false → no warning.

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { Dialog } from '@/components/ui/Dialog';
import {
  TRANSACTION_PROPAGATE_MODES,
  type TransactionPropagateMode,
} from '@/lib/transaction/types';

export interface PropagationChoiceDialogProps {
  open: boolean;
  /**
   * Forward-looking (6.18.1.5.2): when true a data-loss warning block is
   * rendered. Non-period edits in THIS iteration pass false.
   */
  destructive?: boolean;
  /** Disables inputs + shows the confirm spinner while the edit is in flight. */
  pending?: boolean;
  onConfirm(mode: TransactionPropagateMode): void;
  onCancel(): void;
}

export function PropagationChoiceDialog({
  open,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: PropagationChoiceDialogProps) {
  const t = useTranslations('transactions.propagate');
  const [mode, setMode] = useState<TransactionPropagateMode>('self');

  // Reset to the default selection each time the dialog opens.
  useEffect(() => {
    if (open) setMode('self');
  }, [open]);

  if (!open) return null;

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('title')}
      titleId="propagation-choice-title"
      testId="propagation-choice-dialog"
      busy={pending}
      stacked
    >
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{t('description')}</p>

      {destructive && (
        <div
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          role="alert"
          data-testid="propagation-destructive-warning"
        >
          {t('destructiveWarning')}
        </div>
      )}

      <div className="mb-5 space-y-3" role="radiogroup" aria-label={t('title')}>
        {TRANSACTION_PROPAGATE_MODES.map((m) => (
          <label
            key={m}
            className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200"
          >
            <input
              type="radio"
              name="propagation-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              disabled={pending}
              data-testid={`propagation-mode-${m}`}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-gray-900 dark:text-gray-100">
                {t(`mode.${m}.label`)}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {t(`mode.${m}.description`)}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="flex-1"
          onClick={onCancel}
          disabled={pending}
          data-testid="propagation-cancel"
        >
          {t('cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="flex-1"
          onClick={() => onConfirm(mode)}
          disabled={pending}
          aria-busy={pending}
          data-testid="propagation-confirm"
        >
          {pending ? (
            <span className="inline-flex items-center justify-center gap-2">
              <ButtonSpinner />
              <span>{t('confirm')}</span>
            </span>
          ) : (
            t('confirm')
          )}
        </Button>
      </div>
    </Dialog>
  );
}
