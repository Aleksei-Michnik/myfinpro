import { useTranslations } from 'next-intl';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            {t('forgotPasswordTitle')}
          </h1>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
