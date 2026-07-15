'use client';

// Phase 6 · Iteration 6.16 — horizontal scope-tab strip for the /transactions page.
// Phase 6 · Iteration 6.16.2 — converted from <Link>-based tabs to controlled
// <button> tabs. The orchestrator owns URL writes (only emitted on commit).
// Tabs accept a `disabled` prop that cascades from the in-flight container op.

import { useTranslations } from 'next-intl';

export interface TransactionsScopeTabsProps {
  /** `'all'` | `'personal'` | `'group:<id>'`. */
  current: string;
  groups: { id: string; name: string }[];
  /** Called with the new scope key. The orchestrator writes the URL. */
  onChange(scope: string): void;
  /** When true, every tab is disabled (visually + aria-disabled + click guarded). */
  disabled?: boolean;
}

export function TransactionsScopeTabs({
  current,
  groups,
  onChange,
  disabled,
}: TransactionsScopeTabsProps) {
  const t = useTranslations('transactions.page.scopeTabs');

  const tabs: { key: string; label: string }[] = [
    { key: 'all', label: t('all') },
    { key: 'personal', label: t('personal') },
    ...groups.map((g) => ({ key: `group:${g.id}`, label: g.name })),
  ];

  return (
    <div
      role="tablist"
      aria-label={t('all')}
      className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700"
      data-testid="transactions-scope-tabs"
    >
      {tabs.map((tab) => {
        const isActive = current === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-current={isActive ? 'page' : undefined}
            aria-selected={isActive}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              if (isActive) return;
              onChange(tab.key);
            }}
            data-testid={`scope-tab-${tab.key}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isActive
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
