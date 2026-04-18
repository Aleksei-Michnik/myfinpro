'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormState = 'form' | 'sent';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const { addToast } = useToast();
  const [state, setState] = useState<FormState>('form');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  function validateEmail(value: string): string {
    if (!value.trim()) return t('emailRequired');
    if (!EMAIL_REGEX.test(value)) return t('emailInvalid');
    return '';
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const error = validateEmail(email);
    setEmailError(error);
    if (error) return;

    setIsLoading(true);

    try {
      await apiClient.post('/auth/forgot-password', { email });
      setState('sent');
    } catch {
      addToast('error', t('networkError'));
    } finally {
      setIsLoading(false);
    }
  };

  if (state === 'sent') {
    return (
      <div className="space-y-6 text-center" data-testid="check-email-state">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
          <span className="text-2xl" aria-hidden="true">
            ✉️
          </span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t('checkYourEmail')}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('resetLinkSent')}</p>
        <Link
          href="/auth/login"
          className="text-primary-600 hover:text-primary-500 inline-block text-sm font-medium"
        >
          {t('backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        {t('forgotPasswordDescription')}
      </p>

      <Input
        name="email"
        type="email"
        label={t('email')}
        placeholder="user@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setEmailError(validateEmail(email))}
        error={emailError || undefined}
        required
        autoComplete="email"
        disabled={isLoading}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isLoading || !email}
      >
        {isLoading ? t('sendingResetLink') : t('sendResetLink')}
      </Button>

      <p className="text-center text-sm">
        <Link href="/auth/login" className="text-primary-600 hover:text-primary-500 font-medium">
          {t('backToSignIn')}
        </Link>
      </p>
    </form>
  );
}
