'use client';

// Phase 6 · Iteration 6.16.4 — small inline error banner for control-scope
// failures. Used by dialogs and in-place mutations (form save, delete, post
// comment) where opening a full <RetryReturnDialog> would be jarring.
//
// Renders `role="alert"` so AT announces the failure, plus a Retry button.
// Per docs/ui-async-conventions.md → "control-scope inline error banner".

import { useTranslations } from 'next-intl';
import { ButtonSpinner } from './ButtonSpinner';
import type { AsyncErrorReason } from '@/lib/ui';

export interface InlineErrorBannerProps {
  reason: AsyncErrorReason;
  httpStatus?: number;
  /** Override the message — defaults to ui.errors.messages.<reason>. */
  message?: string;
  /** Optional Retry handler. Hidden when not provided. */
  onRetry?: () => void;
  /** Show a button spinner inside the Retry button while a retry is in flight. */
  retrying?: boolean;
  /** Override the Retry label — defaults to ui.errors.retry. */
  retryLabel?: string;
  className?: string;
  'data-testid'?: string;
}

export function InlineErrorBanner({
  reason,
  httpStatus,
  message,
  onRetry,
  retrying = false,
  retryLabel,
  className = '',
  'data-testid': dataTestId = 'inline-error-banner',
}: InlineErrorBannerProps) {
  const t = useTranslations('ui.errors');
  const messageKey = `messages.${reason}` as const;
  const effectiveMessage =
    message ?? t(messageKey, { status: httpStatus !== undefined ? String(httpStatus) : '' });
  const effectiveRetry = retryLabel ?? t('retry');

  return (
    <div
      role="alert"
      data-testid={dataTestId}
      data-reason={reason}
      className={`flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-200 ${className}`}
    >
      <span className="flex-1" data-testid={`${dataTestId}-message`}>
        {effectiveMessage}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          data-testid={`${dataTestId}-retry`}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-900/50"
        >
          {retrying && <ButtonSpinner size="sm" />}
          <span>{effectiveRetry}</span>
        </button>
      )}
    </div>
  );
}
