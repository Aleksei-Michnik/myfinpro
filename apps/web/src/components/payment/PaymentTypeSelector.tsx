'use client';

// Phase 6 · Iteration 6.13 — disclosure-based PaymentType picker.
// ONE_TIME is the only enabled option in this iteration; others show a
// "Coming soon" badge with iteration-hint tooltip (6.18 / 6.20).

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PaymentType } from '@/lib/payment/types';

export interface PaymentTypeSelectorProps {
  value: PaymentType;
  onChange(next: PaymentType): void;
  /** When true, every option — including ONE_TIME — is disabled. */
  disabled?: boolean;
}

const ADVANCED_TYPES: PaymentType[] = [
  'RECURRING',
  'LIMITED_PERIOD',
  'INSTALLMENT',
  'LOAN',
  'MORTGAGE',
];

export function PaymentTypeSelector({ value, onChange, disabled }: PaymentTypeSelectorProps) {
  const t = useTranslations('payments.types');
  const [expanded, setExpanded] = useState(false);

  return (
    <fieldset
      className="rounded-md border border-gray-200 p-3 dark:border-gray-700"
      data-testid="payment-type-selector"
    >
      <legend className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
        {t('label')}
      </legend>

      {/* ONE_TIME radio — always visible and always enabled unless disabled prop */}
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="radio"
          name="payment-type"
          value="ONE_TIME"
          checked={value === 'ONE_TIME'}
          disabled={disabled}
          onChange={() => onChange('ONE_TIME')}
          data-testid="type-radio-ONE_TIME"
          className="h-4 w-4"
        />
        <span>{t('options.ONE_TIME')}</span>
      </label>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid="type-disclosure-toggle"
        aria-expanded={expanded}
        className="mt-2 text-xs text-primary-600 hover:underline focus:outline-none dark:text-primary-400"
      >
        {expanded ? t('hideAdvanced') : t('advanced')}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1" data-testid="type-advanced-list">
          {ADVANCED_TYPES.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"
              title={t(`iterationHint.${type}`)}
            >
              <input
                type="radio"
                name="payment-type"
                value={type}
                checked={value === type}
                disabled
                aria-disabled="true"
                onChange={() => {
                  /* disabled, no-op */
                }}
                data-testid={`type-radio-${type}`}
                className="h-4 w-4"
              />
              <span>{t(`options.${type}`)}</span>
              <span
                className="rounded bg-gray-200 px-1.5 text-[10px] font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                data-testid={`type-badge-${type}`}
              >
                {t('comingSoon')}
              </span>
              <span className="sr-only">{t(`iterationHint.${type}`)}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
