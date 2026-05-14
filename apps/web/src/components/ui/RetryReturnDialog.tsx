'use client';

// Phase 6 · Iteration 6.16.2 — error recovery dialog with Retry / Cancel.
// Portal-mounted to document.body, focus-trapped, focus-restored on close.
// ESC and backdrop click both invoke `onReturn`.
// The Retry button hosts an animated 5 s countdown progress bar; when it
// completes we auto-fire `onRetry` so the user doesn't have to click on
// transient connectivity blips.

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AsyncErrorReason } from '@/lib/ui';

export interface RetryReturnDialogProps {
  open: boolean;
  reason: AsyncErrorReason;
  httpStatus?: number;
  /** Optional override for the title — defaults to ui.errors.title. */
  title?: string;
  /** Optional override for the message — defaults to ui.errors.messages.<reason>. */
  message?: string;
  /** Optional override for the Retry button label — defaults to ui.errors.retry. */
  retryLabel?: string;
  /** Optional override for the Return button label — defaults to ui.errors.return. */
  returnLabel?: string;
  /**
   * Auto-retry countdown duration (ms). The Retry button shows a filling
   * progress bar; when it reaches 100 % we call `onRetry()` automatically.
   * Pass `0` to disable. Default 5000.
   */
  autoRetryMs?: number;
  onRetry(): void;
  onReturn(): void;
}

const DEFAULT_AUTO_RETRY_MS = 5000;

export function RetryReturnDialog({
  open,
  reason,
  httpStatus,
  title,
  message,
  retryLabel,
  returnLabel,
  autoRetryMs = DEFAULT_AUTO_RETRY_MS,
  onRetry,
  onReturn,
}: RetryReturnDialogProps) {
  const t = useTranslations('ui.errors');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Stable refs to the click handlers so the auto-retry timer doesn't
  // restart on prop-identity churn.
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  // Snapshot the previously-focused element on open and restore on close.
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      retryRef.current?.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open]);

  // ESC + Tab focus trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onReturn();
        return;
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onReturn]);

  // Auto-retry: fires onRetry once after `autoRetryMs`. The animated bar
  // (CSS `mfp-countdown`) is the visible counterpart; both share the same
  // duration via the inline custom property below.
  useEffect(() => {
    if (!open) return;
    if (!autoRetryMs || autoRetryMs <= 0) return;
    const timer = setTimeout(() => {
      onRetryRef.current();
    }, autoRetryMs);
    return () => clearTimeout(timer);
  }, [open, autoRetryMs, reason]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const messageKey = `messages.${reason}` as const;
  const effectiveTitle = title ?? t('title');
  const effectiveMessage =
    message ?? t(messageKey, { status: httpStatus !== undefined ? String(httpStatus) : '' });
  const effectiveRetry = retryLabel ?? t('retry');
  const effectiveReturn = returnLabel ?? t('return');
  const showCountdown = autoRetryMs > 0;

  const node = (
    <div
      data-testid="retry-return-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onReturn();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="retry-return-dialog-title"
        aria-describedby="retry-return-dialog-message"
        data-testid="retry-return-dialog"
        data-reason={reason}
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
      >
        <h2
          id="retry-return-dialog-title"
          className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {effectiveTitle}
        </h2>
        <p
          id="retry-return-dialog-message"
          className="mb-4 text-sm text-gray-700 dark:text-gray-300"
          data-testid="retry-return-dialog-message"
        >
          {effectiveMessage}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onReturn}
            data-testid="retry-return-dialog-return"
            className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {effectiveReturn}
          </button>
          <button
            ref={retryRef}
            type="button"
            onClick={onRetry}
            data-testid="retry-return-dialog-retry"
            className="relative inline-flex items-center overflow-hidden rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            {showCountdown && (
              <span
                aria-hidden="true"
                data-testid="retry-return-dialog-countdown"
                className="mfp-countdown pointer-events-none absolute inset-0 bg-primary-700"
                style={
                  {
                    '--mfp-countdown-duration': `${autoRetryMs}ms`,
                  } as React.CSSProperties
                }
              />
            )}
            <span className="relative">{effectiveRetry}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
