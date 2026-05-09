'use client';

// Phase 6 · Iteration 6.16 — star icon toggle button for the /payments page.
// `aria-pressed` reflects state; clicking calls `onChange(!starred)`.

import { useTranslations } from 'next-intl';

export interface StarredFilterToggleProps {
  starred: boolean;
  onChange(starred: boolean): void;
}

export function StarredFilterToggle({ starred, onChange }: StarredFilterToggleProps) {
  const t = useTranslations('payments.page.starredToggle');

  return (
    <button
      type="button"
      onClick={() => onChange(!starred)}
      aria-pressed={starred}
      aria-label={t('ariaPressed')}
      data-testid="starred-filter-toggle"
      className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
        starred
          ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-200'
          : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
    >
      <span aria-hidden="true">{starred ? '★' : '☆'}</span>
      <span>{t('label')}</span>
    </button>
  );
}
