'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';

export default function OAuthCallbackPage() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const { loginWithToken } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent double-processing in React strict mode
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const token = searchParams.get('token');

    if (!token) {
      addToast('error', t('oauthError'));
      router.push('/auth/login');
      return;
    }

    loginWithToken(token)
      .then(() => {
        addToast('success', t('oauthSuccess'));
        router.push('/dashboard');
      })
      .catch(() => {
        addToast('error', t('oauthError'));
        router.push('/auth/login');
      });
  }, [searchParams, loginWithToken, addToast, router, t]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div
          className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-primary-600"
          role="status"
          aria-label={t('googleSignInProgress')}
        />
        <p className="mt-4 text-gray-600 dark:text-gray-400">{t('googleSignInProgress')}</p>
      </div>
    </div>
  );
}
