'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';

type VerifyState = 'loading' | 'success' | 'expired' | 'already-verified' | 'invalid' | 'no-token';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const t = useTranslations('auth');
  const { addToast } = useToast();
  const { resendVerificationEmail, refreshUser } = useAuth();
  const [state, setState] = useState<VerifyState>('loading');
  const [isResending, setIsResending] = useState(false);
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setState('no-token');
      return;
    }

    // Prevent duplicate verification calls (e.g. when refreshUser identity changes)
    if (verifiedRef.current) return;
    verifiedRef.current = true;

    const verify = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          setState('success');
          await refreshUser();
        } else {
          const error = await res.json().catch(() => ({ errorCode: 'UNKNOWN' }));
          const errorCode = (error as { errorCode?: string }).errorCode;
          if (errorCode === 'AUTH_VERIFICATION_TOKEN_EXPIRED') {
            setState('expired');
          } else if (
            errorCode === 'AUTH_EMAIL_ALREADY_VERIFIED' ||
            errorCode === 'AUTH_VERIFICATION_TOKEN_USED'
          ) {
            setState('already-verified');
          } else {
            setState('invalid');
          }
        }
      } catch {
        setState('invalid');
      }
    };

    verify();
  }, [token]);

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
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {state === 'loading' && (
          <div data-testid="verify-loading">
            <div
              className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"
              role="status"
            />
            <p className="text-gray-600 dark:text-gray-400">{t('verifyEmail')}...</p>
          </div>
        )}

        {state === 'success' && (
          <div data-testid="verify-success">
            <span className="mb-4 block text-4xl" aria-hidden="true">
              ✅
            </span>
            <h1 className="mb-2 text-xl font-semibold text-green-700 dark:text-green-400">
              {t('verifyEmailSuccess')}
            </h1>
            <Link
              href="/dashboard"
              className="mt-4 inline-block rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
            >
              {t('goToDashboard')}
            </Link>
          </div>
        )}

        {state === 'expired' && (
          <div data-testid="verify-expired">
            <span className="mb-4 block text-4xl" aria-hidden="true">
              ⏰
            </span>
            <h1 className="mb-2 text-xl font-semibold text-amber-700 dark:text-amber-400">
              {t('verifyEmailExpired')}
            </h1>
            <button
              onClick={handleResend}
              disabled={isResending}
              className="mt-4 inline-block rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="resend-btn"
            >
              {isResending ? t('resendingVerification') : t('resendVerification')}
            </button>
          </div>
        )}

        {state === 'already-verified' && (
          <div data-testid="verify-already">
            <span className="mb-4 block text-4xl" aria-hidden="true">
              ✅
            </span>
            <h1 className="mb-2 text-xl font-semibold text-green-700 dark:text-green-400">
              {t('verifyEmailAlreadyVerified')}
            </h1>
            <Link
              href="/dashboard"
              className="mt-4 inline-block rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
            >
              {t('goToDashboard')}
            </Link>
          </div>
        )}

        {state === 'invalid' && (
          <div data-testid="verify-invalid">
            <span className="mb-4 block text-4xl" aria-hidden="true">
              ❌
            </span>
            <h1 className="mb-2 text-xl font-semibold text-red-700 dark:text-red-400">
              {t('verifyEmailInvalid')}
            </h1>
          </div>
        )}

        {state === 'no-token' && (
          <div data-testid="verify-no-token">
            <span className="mb-4 block text-4xl" aria-hidden="true">
              ❌
            </span>
            <h1 className="mb-2 text-xl font-semibold text-red-700 dark:text-red-400">
              {t('verifyEmailInvalid')}
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('checkInbox')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
