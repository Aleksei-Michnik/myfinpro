'use client';

// Phase 8.27 — THE generic confirmation modal for destructive or otherwise
// irreversible actions (docs/image-handling.md §4). Conditionally rendered by
// the parent; the parent owns the operation — this component only collects the
// decision. Phase 20.1 — a thin composition of <Dialog>, which owns the shell
// and the behaviour (ESC, backdrop, focus, scroll lock).

import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { Dialog } from '@/components/ui/Dialog';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive action — the confirm button turns red. */
  danger?: boolean;
  /** In-flight (useAsyncOperation isLoading) — spinner + disabled confirm. */
  busy?: boolean;
  /** Nested on top of another open `Dialog` (e.g. the token reveal's close prompt). */
  stacked?: boolean;
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
  stacked = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      titleId="confirm-dialog-title"
      testId="confirm-dialog"
      danger={danger}
      busy={busy}
      stacked={stacked}
    >
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
          variant={danger ? 'danger' : 'primary'}
          size="md"
          className="flex-1"
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
    </Dialog>
  );
}
