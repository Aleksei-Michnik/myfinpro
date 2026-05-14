'use client';

// Phase 6 · Iteration 6.16.2 — inline spinner for buttons that own a
// useAsyncOperation({ scope: 'control' }). Caller is responsible for
// `disabled={isLoading}` and `aria-busy={isLoading}`.

import { Spinner, type SpinnerSize } from './Spinner';

export interface ButtonSpinnerProps {
  size?: SpinnerSize;
  className?: string;
  'data-testid'?: string;
}

export function ButtonSpinner({
  size = 'sm',
  className = '',
  'data-testid': dataTestId = 'button-spinner',
}: ButtonSpinnerProps) {
  return <Spinner size={size} className={className} data-testid={dataTestId} />;
}
