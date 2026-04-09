'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth/auth-context';

export function VerificationBanner() {
  const { user, isAuthenticated, resendVerificationEmail } = useAuth();
  const t = useTranslations('auth');
  const { addToast } = useToast();
  const [isResending, setIsResending] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Don't show if not authenticated, already verified, dismissed,
  // or if the user is a Telegram user (placeholder email)
  if (!isAuthenticated || !user) return null;
  if (user.emailVerified) return null;
  if (isDismissed) return null;
  if (user.email.includes('@telegram.user')) return null;

  const handleResend = async () => {
    setIsResending(true);
    try {
      await resendVerificationEmail();
      addToast('success', t('verifyEmailSent'));
    } catch {
      addToast('error', t('networkError'));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="verification-banner"
      className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
    >
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden="true">⚠</span>
        <span>
          {t('verifyEmailBanner')}{' '}
          <button
            onClick={handleResend}
            disabled={isResending}
            className="font-medium underline hover:no-underline disabled:opacity-50"
            data-testid="resend-verification-btn"
          >
            {isResending ? t('resendingVerification') : t('resendVerification')}
          </button>
        </span>
      </div>
      <button
        onClick={() => setIsDismissed(true)}
        className="shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
        aria-label="Dismiss"
        data-testid="dismiss-banner-btn"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
