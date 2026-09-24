'use client';

// Phase 20 · Iteration 20.1 — THE tab strip, extracted from
// `TransactionsScopeTabs` (which is now a thin wrapper that builds the items).
// Controlled: the caller owns `current` and reacts to `onChange`.

import type { ReactNode } from 'react';
import { cx } from './styles';

export interface TabItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  /** `data-testid` of the tab button; defaults to `<testId>-<key>`. */
  testId?: string;
}

export interface TabsProps {
  items: TabItem[];
  current: string;
  onChange(key: string): void;
  /** Disables every tab (e.g. while a container-scope op is in flight). */
  disabled?: boolean;
  /** Accessible name of the tablist. */
  ariaLabel: string;
  className?: string;
  'data-testid'?: string;
}

export function Tabs({
  items,
  current,
  onChange,
  disabled = false,
  ariaLabel,
  className = '',
  'data-testid': testId,
}: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx(
        'flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700',
        className,
      )}
      data-testid={testId}
    >
      {items.map((tab) => {
        const isActive = current === tab.key;
        const isDisabled = disabled || tab.disabled === true;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-current={isActive ? 'page' : undefined}
            aria-selected={isActive}
            aria-disabled={isDisabled || undefined}
            disabled={isDisabled}
            onClick={() => {
              if (isDisabled || isActive) return;
              onChange(tab.key);
            }}
            data-testid={tab.testId ?? (testId ? `${testId}-${tab.key}` : undefined)}
            className={cx(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              isActive
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
