'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { useTelegramLogin } from '@/components/auth/TelegramLoginButton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';

const TELEGRAM_BOT_ID = process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterForm() {
  const t = useTranslations('auth');
  const { register, loginWithTelegram } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [generalError, setGeneralError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { triggerLogin: triggerTelegramLogin, isLoading: isTelegramLoading } = useTelegramLogin({
    botId: TELEGRAM_BOT_ID || '',
    onAuth: async (result) => {
      setGeneralError('');
      setIsLoading(true);
      try {
        await loginWithTelegram(result);
        addToast('success', t('telegramAuthSuccess'));
        router.push('/dashboard');
      } catch (err) {
        setGeneralError(err instanceof Error ? err.message : t('telegramAuthFailed'));
      } finally {
        setIsLoading(false);
      }
    },
    onError: () => {
      // User cancelled — no action needed
    },
  });

  function validateField(field: string, value: string): string | undefined {
    switch (field) {
      case 'name':
        if (!value.trim()) return t('nameRequired');
        if (value.length > 100) return t('nameMaxLength');
        return undefined;
      case 'email':
        if (!value.trim()) return t('emailRequired');
        if (!EMAIL_REGEX.test(value)) return t('emailInvalid');
        return undefined;
      case 'password':
        if (!value) return t('passwordRequired');
        if (value.length < 8) return t('passwordMinLength');
        if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
          return t('passwordRequirements');
        }
        return undefined;
      case 'confirmPassword':
        if (value !== password) return t('passwordMismatch');
        return undefined;
      default:
        return undefined;
    }
  }

  function validateAll(): FieldErrors {
    return {
      name: validateField('name', name),
      email: validateField('email', email),
      password: validateField('password', password),
      confirmPassword: validateField('confirmPassword', confirmPassword),
    };
  }

  function handleBlur(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const value = { name, email, password, confirmPassword }[field] ?? '';
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error }));
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGeneralError('');

    const fieldErrors = validateAll();
    setErrors(fieldErrors);
    setTouched({ name: true, email: true, password: true, confirmPassword: true });

    const hasErrors = Object.values(fieldErrors).some(Boolean);
    if (hasErrors) return;

    setIsLoading(true);

    try {
      await register({ email, password, name });
      addToast('success', t('registrationSuccess'));
      router.push('/dashboard');
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : t('emailAlreadyExists'));
    } finally {
      setIsLoading(false);
    }
  };

  const isFormEmpty = !name && !email && !password && !confirmPassword;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {generalError && (
        <div className="rounded-md bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-700">{generalError}</p>
        </div>
      )}

      <Input
        name="name"
        type="text"
        label={t('name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => handleBlur('name')}
        error={touched.name ? errors.name : undefined}
        required
        autoComplete="name"
        disabled={isLoading}
      />

      <Input
        name="email"
        type="email"
        label={t('email')}
        placeholder="user@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => handleBlur('email')}
        error={touched.email ? errors.email : undefined}
        required
        autoComplete="email"
        disabled={isLoading}
      />

      <div>
        <Input
          name="password"
          type="password"
          label={t('password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => handleBlur('password')}
          error={touched.password ? errors.password : undefined}
          required
          autoComplete="new-password"
          disabled={isLoading}
        />
        <PasswordStrength password={password} />
      </div>

      <Input
        name="confirmPassword"
        type="password"
        label={t('confirmPassword')}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        onBlur={() => handleBlur('confirmPassword')}
        error={touched.confirmPassword ? errors.confirmPassword : undefined}
        required
        autoComplete="new-password"
        disabled={isLoading}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isLoading || isFormEmpty}
      >
        {isLoading ? t('signingUp') : t('signUp')}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-gray-500">{t('orSignUpWith')}</span>
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
            {isTelegramLoading ? t('signingUp') : t('telegram')}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled className="opacity-50">
            {t('telegram')}
          </Button>
        )}
      </div>

      <p className="text-center text-sm text-gray-600">
        {t('hasAccount')}{' '}
        <Link href="/auth/login" className="text-primary-600 hover:text-primary-500 font-medium">
          {t('signIn')}
        </Link>
      </p>
    </form>
  );
}
