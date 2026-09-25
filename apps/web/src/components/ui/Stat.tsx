'use client';

// Phase 20 · Iteration 20.1 — THE figure: a label with a number under it.
// Used by the dashboard totals today and by account balances from 20.3.

import type { ReactNode } from 'react';
import { cx } from './styles';

export type StatTone = 'neutral' | 'positive' | 'negative' | 'muted' | 'warning';

const TONES: Record<StatTone, string> = {
  neutral: 'text-gray-900 dark:text-gray-100',
  positive: 'text-green-700 dark:text-green-400',
  negative: 'text-red-700 dark:text-red-400',
  muted: 'text-gray-500 dark:text-gray-400',
  // Phase 20 · Iteration 20.7 — the connector-tokens "at the cap" figure.
  warning: 'text-amber-700 dark:text-amber-400',
};

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Secondary line under the value (as-of date, comparison, …). */
  hint?: ReactNode;
  tone?: StatTone;
  /** `md` (default) for cards, `sm` inside dense rows. */
  size?: 'sm' | 'md';
  className?: string;
  /** `data-testid` of the value element — the number is what tests read. */
  valueTestId?: string;
  'data-testid'?: string;
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  size = 'md',
  className = '',
  valueTestId,
  'data-testid': testId,
}: StatProps) {
  return (
    <div className={cx('min-w-0', className)} data-testid={testId}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={cx('font-semibold', size === 'md' ? 'text-lg' : 'text-sm', TONES[tone])}
        data-testid={valueTestId}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}
