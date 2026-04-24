'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth/auth-context';

interface FieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

const ERROR_CODE_MAP: Record<string, string> = {
  AUTH_INVALID_CURRENT_PASSWORD: 'invalidCurrent',
  AUTH_PASSWORD_SAME_AS_CURRENT: 'sameAsCurrent',
  AUTH_PASSWORD_NOT_SET: 'passwordNotSet',
};

export function ChangePasswordForm() {
  const t = useTranslations('settings.account.password');
  const { changePassword } = useAuth();
  const { addToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validateField = (field: string, value: string): string | undefined => {
    switch (field) {
      case 'currentPassword':
        if (!value) return t('errors.currentRequired');
        return undefined;
      case 'newPassword':
        if (!value) return t('errors.newRequired');
        if (value.length < 8) return t('errors.newTooShort');
        if (value === currentPassword) return t('errors.sameAsCurrent');
        return undefined;
      case 'confirmPassword':
        if (!value) return t('errors.confirmRequired');
        if (value !== newPassword) return t('errors.passwordMismatch');
        return undefined;
      default:
        return undefined;
    }
  };

  const validateAll = (): FieldErrors => ({
    currentPassword: validateField('currentPassword', currentPassword),
    newPassword: validateField('newPassword', newPassword),
    confirmPassword: validateField('confirmPassword', confirmPassword),
  });

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const value =
      field === 'currentPassword'
        ? currentPassword
        : field === 'newPassword'
          ? newPassword
          : confirmPassword;
    setErrors((prev) => ({ ...prev, [field]: validateField(field, value) }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    const fieldErrors = validateAll();
    setErrors(fieldErrors);
    setTouched({ currentPassword: true, newPassword: true, confirmPassword: true });

    const hasErrors = Object.values(fieldErrors).some(Boolean);
    if (hasErrors) return;

    setIsLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      addToast('success', t('successMessage'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTouched({});
      setErrors({});
    } catch (err) {
      const errorCode = (err as { errorCode?: string }).errorCode;
      if (errorCode && ERROR_CODE_MAP[errorCode]) {
        setFormError(t(`errors.${ERROR_CODE_MAP[errorCode]}`));
      } else {
        setFormError(t('errors.generic'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      noValidate
      data-testid="change-password-form"
    >
      {formError && (
        <div className="rounded-md bg-red-50 p-3 dark:bg-red-900/30" role="alert">
          <p className="text-sm text-red-700 dark:text-red-300">{formError}</p>
        </div>
      )}

      <Input
        name="currentPassword"
        type="password"
        label={t('currentPasswordLabel')}
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        onBlur={() => handleBlur('currentPassword')}
        error={touched.currentPassword ? errors.currentPassword : undefined}
        required
        autoComplete="current-password"
        disabled={isLoading}
      />

      <div>
        <Input
          name="newPassword"
          type="password"
          label={t('newPasswordLabel')}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          onBlur={() => handleBlur('newPassword')}
          error={touched.newPassword ? errors.newPassword : undefined}
          required
          autoComplete="new-password"
          disabled={isLoading}
        />
        <PasswordStrength password={newPassword} />
      </div>

      <Input
        name="confirmPassword"
        type="password"
        label={t('confirmPasswordLabel')}
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
        size="md"
        disabled={isLoading || !currentPassword || !newPassword || !confirmPassword}
        data-testid="change-password-submit"
      >
        {isLoading ? t('submitting') : t('submitButton')}
      </Button>
    </form>
  );
}
