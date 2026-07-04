'use client';

// Phase 6 · Iteration 6.16.2 — shared SVG spinner primitive.
// Used by <ButtonSpinner>, <InlineLoader>, <LoadingOverlay>. The surrounding
// component is responsible for announcements (role="status" + aria-busy);
// this primitive marks itself aria-hidden.

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  /** Optional tint override; defaults to currentColor. */
  color?: string;
  'data-testid'?: string;
}

const SIZE_PX: Record<SpinnerSize, number> = {
  sm: 12,
  md: 16,
  lg: 32,
};

export function Spinner({
  size = 'md',
  className = '',
  color,
  'data-testid': dataTestId,
}: SpinnerProps) {
  const px = SIZE_PX[size];
  return (
    <svg
      role="img"
      aria-hidden="true"
      data-testid={dataTestId}
      data-size={size}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`mfp-spinner inline-block ${className}`}
      style={color ? { color } : undefined}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
