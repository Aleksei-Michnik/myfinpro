'use client';

// Phase 8.27 — THE generic confirmation modal for destructive or otherwise
// irreversible actions (docs/image-handling.md §4). Conditionally rendered
// by the parent; dialog semantics follow DeleteTransactionDialog (role,
// aria-modal, ESC close, backdrop mousedown close, red confirm on danger,
// ButtonSpinner while busy). The parent owns the actual operation — this
// component only collects the decision.

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { useBodyScrollLock } from '@/lib/ui';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive action — the confirm button turns red. */
  danger?: boolean;
  /** In-flight (useAsyncOperation isLoading) — spinner + disabled confirm. */
  busy?: boolean;
  onConfirm(): void;
  onClose(): void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  // Conditionally rendered by the parent — mounted means open.
  useBodyScrollLock(true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-busy={busy || undefined}
    >
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3
          id="confirm-dialog-title"
          className={`mb-4 text-lg font-semibold ${
            danger ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {title}
        </h3>
        <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">{message}</p>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={onClose}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className={`flex-1 ${danger ? '!bg-red-600 hover:!bg-red-700 focus:!ring-red-500' : ''}`}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
            data-testid="confirm-dialog-confirm"
          >
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <ButtonSpinner />
                <span>{confirmLabel}</span>
              </span>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
