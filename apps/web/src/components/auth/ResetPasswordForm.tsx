'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';

type FormState = 'form' | 'success' | 'error';

interface ResetPasswordFormProps {
  token: string;
}

interface FieldErrors {
  password?: string;
  confirmPassword?: string;
}

const ERROR_CODE_MAP: Record<string, string> = {
  AUTH_RESET_TOKEN_EXPIRED: 'resetPasswordExpired',
  AUTH_RESET_TOKEN_USED: 'resetPasswordUsed',
  AUTH_RESET_TOKEN_INVALID: 'resetPasswordInvalid',
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations('auth');
  const [state, setState] = useState<FormState>('form');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  function validateField(field: string, value: string): string | undefined {
    switch (field) {
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
      password: validateField('password', password),
      confirmPassword: validateField('confirmPassword', confirmPassword),
    };
  }

  function handleBlur(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const value = field === 'password' ? password : confirmPassword;
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error }));
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const fieldErrors = validateAll();
    setErrors(fieldErrors);
    setTouched({ password: true, confirmPassword: true });

    const hasErrors = Object.values(fieldErrors).some(Boolean);
    if (hasErrors) return;

    setIsLoading(true);

    try {
      await apiClient.post('/auth/reset-password', { token, password });
      setState('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // Check for known error codes in the message
      for (const [code, translationKey] of Object.entries(ERROR_CODE_MAP)) {
        if (message.includes(code)) {
          setErrorMessage(t(translationKey));
          setState('error');
          setIsLoading(false);
          return;
        }
      }
      // Fallback: show the error message from API or a generic one
      setErrorMessage(t('resetPasswordInvalid'));
      setState('error');
    } finally {
      setIsLoading(false);
    }
  };

  if (state === 'success') {
    return (
      <div className="space-y-6 text-center" data-testid="reset-success-state">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
          <span className="text-2xl" aria-hidden="true">
            ✓
          </span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t('resetPasswordSuccess')}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('resetPasswordSuccessDescription')}
        </p>
        <Link
          href="/auth/login"
          className="text-primary-600 hover:text-primary-500 inline-block text-sm font-medium"
        >
          {t('goToSignIn')}
        </Link>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-6 text-center" data-testid="reset-error-state">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
          <span className="text-2xl" aria-hidden="true">
            ✕
          </span>
        </div>
        <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
        <Link
          href="/auth/forgot-password"
          className="text-primary-600 hover:text-primary-500 inline-block text-sm font-medium"
        >
          {t('requestNewLink')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div>
        <Input
          name="password"
          type="password"
          label={t('newPassword')}
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
        disabled={isLoading || !password || !confirmPassword}
      >
        {isLoading ? t('resettingPassword') : t('resetPassword')}
      </Button>

      <p className="text-center text-sm">
        <Link href="/auth/login" className="text-primary-600 hover:text-primary-500 font-medium">
          {t('backToSignIn')}
        </Link>
      </p>
    </form>
  );
}
