'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useTelegramLogin } from '@/components/auth/TelegramLoginButton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';

const TELEGRAM_BOT_ID = process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID;

export function LoginForm() {
  const t = useTranslations('auth');
  const { login, loginWithTelegram } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { triggerLogin: triggerTelegramLogin, isLoading: isTelegramLoading } = useTelegramLogin({
    botId: TELEGRAM_BOT_ID || '',
    onAuth: async (result) => {
      setError('');
      setIsLoading(true);
      try {
        await loginWithTelegram(result);
        addToast('success', t('telegramAuthSuccess'));
        const redirect = searchParams.get('redirect');
        router.push(redirect || '/dashboard');
      } catch (err) {
        setError(err instanceof Error ? err.message : t('telegramAuthFailed'));
      } finally {
        setIsLoading(false);
      }
    },
    onError: () => {
      // User cancelled — no action needed
    },
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login({ email, password });
      addToast('success', t('loginSuccess'));
      const redirect = searchParams.get('redirect');
      router.push(redirect || '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {error && (
        <div className="rounded-md bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <Input
        name="email"
        type="email"
        label={t('email')}
        placeholder="user@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        disabled={isLoading}
      />

      <Input
        name="password"
        type="password"
        label={t('password')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        disabled={isLoading}
      />

      <div className="flex justify-end">
        <Link
          href="/auth/forgot-password"
          className="text-primary-600 hover:text-primary-500 text-sm font-medium"
        >
          {t('forgotPassword')}
        </Link>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isLoading || !email || !password}
      >
        {isLoading ? t('signingIn') : t('signIn')}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-gray-500">{t('orSignInWith')}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.location.href = '/api/v1/auth/google';
          }}
        >
          {t('google')}
        </Button>
        {TELEGRAM_BOT_ID ? (
          <Button
            type="button"
            variant="outline"
            onClick={triggerTelegramLogin}
            disabled={isLoading || isTelegramLoading}
          >
            {isTelegramLoading ? t('signingIn') : t('telegram')}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled className="opacity-50">
            {t('telegram')}
          </Button>
        )}
      </div>

      <p className="text-center text-sm text-gray-600">
        {t('noAccount')}{' '}
        <Link href="/auth/register" className="text-primary-600 hover:text-primary-500 font-medium">
          {t('signUp')}
        </Link>
      </p>
    </form>
  );
}
