'use client';

// Phase 6 · Iteration 6.13 — disclosure-based TransactionType picker.
// 6.18.1 enabled RECURRING; 6.20 enables the plan kinds (INSTALLMENT /
// LOAN / MORTGAGE) in CREATE mode — plan parents are not editable, so the
// edit flow passes `planKindsEnabled={false}` and they fall back to the
// disabled "coming soon"-style rendering. LIMITED_PERIOD still ships later.

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { TransactionType } from '@/lib/transaction/types';

export interface TransactionTypeSelectorProps {
  value: TransactionType;
  onChange(next: TransactionType): void;
  /** When true, every option — including ONE_TIME — is disabled. */
  disabled?: boolean;
  /**
   * Plan kinds are create-only (the API cannot convert an existing transaction
   * into a plan parent). Defaults to true; the edit flow passes false.
   */
  planKindsEnabled?: boolean;
}

// Phase 6 · Iteration 6.18.1 — RECURRING moves out of the "coming soon"
// list; 6.20 moves the plan kinds out too (create mode only).
const PLAN_KIND_TYPES: TransactionType[] = ['INSTALLMENT', 'LOAN', 'MORTGAGE'];
const ALWAYS_COMING_SOON: TransactionType[] = ['LIMITED_PERIOD'];

export function TransactionTypeSelector({
  value,
  onChange,
  disabled,
  planKindsEnabled = true,
}: TransactionTypeSelectorProps) {
  const enabledAdvancedTypes: TransactionType[] = planKindsEnabled
    ? ['RECURRING', ...PLAN_KIND_TYPES]
    : ['RECURRING'];
  const comingSoonTypes: TransactionType[] = planKindsEnabled
    ? ALWAYS_COMING_SOON
    : [...ALWAYS_COMING_SOON, ...PLAN_KIND_TYPES];
  const t = useTranslations('transactions.types');
  const [expanded, setExpanded] = useState(false);

  return (
    <fieldset
      className="rounded-md border border-gray-200 p-3 dark:border-gray-700"
      data-testid="transaction-type-selector"
    >
      <legend className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
        {t('label')}
      </legend>

      {/* ONE_TIME radio — always visible and always enabled unless disabled prop */}
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="radio"
          name="transaction-type"
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
          {enabledAdvancedTypes.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
            >
              <input
                type="radio"
                name="transaction-type"
                value={type}
                checked={value === type}
                disabled={disabled}
                onChange={() => onChange(type)}
                data-testid={`type-radio-${type}`}
                className="h-4 w-4"
              />
              <span>{t(`options.${type}`)}</span>
            </label>
          ))}
          {comingSoonTypes.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"
              title={t(`iterationHint.${type}`)}
            >
              <input
                type="radio"
                name="transaction-type"
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
