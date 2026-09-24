'use client';

// Phase 20 · Iteration 20.1 — THE "nothing here" block. `bordered` (default)
// is the dashed frame a page shows when its whole list is empty; `bordered={false}`
// is the plain centred line used inside a card or a dialog list.

import type { ReactNode } from 'react';
import { cx } from './styles';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A button or link that resolves the emptiness. */
  action?: ReactNode;
  /** Decorative glyph above the title (`aria-hidden` is the caller's job). */
  icon?: ReactNode;
  bordered?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  bordered = true,
  className = '',
  'data-testid': testId,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'text-center text-sm text-gray-500 dark:text-gray-400',
        bordered
          ? 'rounded-xl border border-dashed border-gray-300 p-10 dark:border-gray-600'
          : 'py-12',
        className,
      )}
      data-testid={testId}
    >
      {icon && <div className="mb-2 flex justify-center">{icon}</div>}
      <p className="font-medium text-gray-700 dark:text-gray-300">{title}</p>
      {description && <p className="mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
