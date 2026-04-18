'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { Link } from '@/i18n/navigation';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  if (!token) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6 text-center">
          <p className="text-sm text-red-700">{t('resetPasswordInvalid')}</p>
          <Link
            href="/auth/forgot-password"
            className="text-primary-600 hover:text-primary-500 inline-block text-sm font-medium"
          >
            {t('requestNewLink')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t('resetPasswordTitle')}
          </h1>
        </div>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
