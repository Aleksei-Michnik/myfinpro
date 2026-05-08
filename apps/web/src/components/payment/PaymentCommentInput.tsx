'use client';

// Phase 6 · Iteration 6.14 — composer for new comments.
// Parent (the list) owns append behaviour via `onPosted`.

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { usePayments } from '@/lib/payment/payment-context';
import type { Comment } from '@/lib/payment/types';

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError(t('validation.tooShort'));
      return;
    }
    if (trimmed.length > MAX_LEN) {
      setError(t('validation.tooLong'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const c = await postComment(paymentId, trimmed);
      setValue('');
      onPosted(c);
    } catch (e) {
      setError(t('errorPost', { message: (e as Error).message || '' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="payment-comment-input">
      <label className="block">
        <span className="sr-only">{t('postPlaceholder')}</span>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('postPlaceholder')}
          maxLength={MAX_LEN}
          rows={3}
          disabled={disabled || submitting}
          data-testid="comment-input-textarea"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>
      {error && (
        <p className="text-xs text-red-600" role="alert" data-testid="comment-input-error">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={disabled || submitting}
          data-testid="comment-input-submit"
        >
          {submitting ? t('posting') : t('post')}
        </Button>
      </div>
    </div>
  );
}
