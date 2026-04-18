'use client';

import { useTranslations } from 'next-intl';

interface PasswordStrengthProps {
  password: string;
}

interface Requirement {
  key: string;
  label: string;
  met: boolean;
}

function getRequirements(password: string, t: (key: string) => string): Requirement[] {
  return [
    { key: 'minLength', label: t('requireMinLength'), met: password.length >= 8 },
    { key: 'uppercase', label: t('requireUppercase'), met: /[A-Z]/.test(password) },
    { key: 'lowercase', label: t('requireLowercase'), met: /[a-z]/.test(password) },
    { key: 'number', label: t('requireNumber'), met: /\d/.test(password) },
  ];
}

function getStrength(requirements: Requirement[]): number {
  const metCount = requirements.filter((r) => r.met).length;
  return metCount;
}

const strengthConfig: Record<number, { label: string; color: string; width: string }> = {
  0: { label: '', color: 'bg-gray-200', width: 'w-0' },
  1: { label: 'strengthWeak', color: 'bg-red-500', width: 'w-1/4' },
  2: { label: 'strengthFair', color: 'bg-orange-500', width: 'w-2/4' },
  3: { label: 'strengthGood', color: 'bg-yellow-500', width: 'w-3/4' },
  4: { label: 'strengthStrong', color: 'bg-green-500', width: 'w-full' },
};

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const t = useTranslations('auth');
  const requirements = getRequirements(password, t);
  const strength = getStrength(requirements);
  const config = strengthConfig[strength];

  if (!password) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2" data-testid="password-strength">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div
          className="h-2 flex-1 rounded-full bg-gray-200 dark:bg-gray-700"
          role="progressbar"
          aria-valuenow={strength}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-label={t('passwordStrength')}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${config.color} ${config.width}`}
          />
        </div>
        {config.label && (
          <span
            className={`text-xs font-medium ${strength <= 1 ? 'text-red-600' : strength === 2 ? 'text-orange-600' : strength === 3 ? 'text-yellow-600' : 'text-green-600'}`}
          >
            {t(config.label)}
          </span>
        )}
      </div>

      {/* Requirements checklist */}
      <ul className="space-y-1">
        {requirements.map((req) => (
          <li key={req.key} className="flex items-center gap-1.5 text-xs">
            <span
              className={req.met ? 'text-green-500' : 'text-gray-400 dark:text-gray-500'}
              aria-hidden="true"
            >
              {req.met ? '✓' : '○'}
            </span>
            <span
              className={
                req.met ? 'text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'
              }
            >
              {req.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
