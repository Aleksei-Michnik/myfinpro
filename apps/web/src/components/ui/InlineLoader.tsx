'use client';

// Phase 6 · Iteration 6.16.2 — inline (text + spinner) loading indicator.
// Used inside "Load more" buttons and similar non-modal affordances.

import { Spinner, type SpinnerSize } from './Spinner';

export interface InlineLoaderProps {
  label?: string;
  size?: SpinnerSize;
  className?: string;
  'data-testid'?: string;
}

export function InlineLoader({
  label,
  size = 'sm',
  className = '',
  'data-testid': dataTestId = 'inline-loader',
}: InlineLoaderProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={dataTestId}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <Spinner size={size} />
      {label !== undefined && <span>{label}</span>}
    </span>
  );
}
