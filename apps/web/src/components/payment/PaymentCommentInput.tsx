'use client';

// Phase 6 · Iteration 6.14 — composer for new comments.
// Phase 6 · Iteration 6.16.4 — migrated to useAsyncOperation({ scope: 'control' }).
// Send button shows <ButtonSpinner>, is disabled + aria-busy while POSTing.
// Network/timeout/HTTP failures surface as an inline error banner with
// Retry; validation errors stay as plain inline messages under the textarea.

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { usePayments } from '@/lib/payment/payment-context';
import type { Comment } from '@/lib/payment/types';
import { useAsyncOperation } from '@/lib/ui';

export interface PaymentCommentInputProps {
  paymentId: string;
  onPosted(comment: Comment): void;
  disabled?: boolean;
}

const MAX_LEN = 2000;

export function PaymentCommentInput({ paymentId, onPosted, disabled }: PaymentCommentInputProps) {
  const t = useTranslations('payments.comments');
  const { postComment } = usePayments();
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submitOp = useAsyncOperation<Comment>({ scope: 'control' });
  const isLoading = submitOp.isLoading;
  const isDisabled = disabled || isLoading;

  const runSubmit = (content: string) =>
    submitOp
      .run((signal) => postComment(paymentId, content, signal))
      .then((c) => {
        if (c) {
          setValue('');
          onPosted(c);
        }
      });

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setValidationError(t('validation.tooShort'));
      return;
    }
    if (trimmed.length > MAX_LEN) {
      setValidationError(t('validation.tooLong'));
      return;
    }
    setValidationError(null);
    void runSubmit(trimmed);
  };

  const handleRetry = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_LEN) return;
    void runSubmit(trimmed);
  };

  return (
    <div
      className="space-y-2"
      data-testid="payment-comment-input"
      aria-busy={isLoading || undefined}
    >
      <label className="block">
        <span className="sr-only">{t('postPlaceholder')}</span>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('postPlaceholder')}
          maxLength={MAX_LEN}
          rows={3}
          disabled={isDisabled}
          data-testid="comment-input-textarea"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>
      {validationError && (
        <p className="text-xs text-red-600" role="alert" data-testid="comment-input-error">
          {validationError}
        </p>
      )}
      {submitOp.isError && submitOp.error && (
        <InlineErrorBanner
          reason={submitOp.error.reason}
          httpStatus={submitOp.error.httpStatus}
          message={t('errorPost', { message: submitOp.error.message ?? '' })}
          onRetry={handleRetry}
          retrying={isLoading}
          data-testid="comment-input-banner"
        />
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={isDisabled}
          aria-busy={isLoading}
          data-testid="comment-input-submit"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <ButtonSpinner />
              <span>{t('posting')}</span>
            </span>
          ) : (
            t('post')
          )}
        </Button>
      </div>
    </div>
  );
}
