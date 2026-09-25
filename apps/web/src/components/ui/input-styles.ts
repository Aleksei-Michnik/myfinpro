// THE form-control style. One definition shared by <Input>, <Select> and
// <Textarea> (20.1) and by the few raw controls that cannot use them yet.
// Extracted in 8.24 as `inputClass` for dense editing surfaces (receipt
// review, walkthrough search); 20.1 generalised it into `controlClass` so the
// compact and the roomy variants are one string with a size, not two.

import { cx } from './styles';

/** `sm` = dense editing surfaces (cards, filter rows); `md` = standalone forms. */
export type ControlSize = 'sm' | 'md';

const BASE =
  'rounded-md border bg-white text-gray-900 transition-colors placeholder:text-gray-400 ' +
  'focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'dark:text-gray-100 dark:placeholder:text-gray-500';

// The dark surface differs by size on purpose: dense controls sit on a
// gray-800 card, roomy ones on the page background.
const SIZES: Record<ControlSize, string> = {
  sm: 'px-2 py-1.5 text-sm dark:bg-gray-800',
  md: 'px-3 py-2 text-sm dark:bg-gray-700',
};

const NEUTRAL =
  'border-gray-300 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600';
const INVALID = 'border-red-500 focus:border-red-500 focus:ring-red-500';

export interface ControlClassOptions {
  size?: ControlSize;
  /** Invalid state — red border and ring. */
  error?: boolean;
  /** Emit `w-full` (default). Pass `false` for inline controls. */
  fullWidth?: boolean;
  /** Extra classes appended last. */
  className?: string;
}

export function controlClass({
  size = 'md',
  error = false,
  fullWidth = true,
  className = '',
}: ControlClassOptions = {}): string {
  return cx(BASE, SIZES[size], error ? INVALID : NEUTRAL, fullWidth && 'w-full', className);
}

/** Label above a control. */
export const controlLabelClass = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

/** Validation message below a control. */
export const controlErrorClass = 'mt-1 text-sm text-red-600 dark:text-red-400';

/** Compact control style — `controlClass({ size: 'sm' })`, kept as a constant. */
export const inputClass = controlClass({ size: 'sm' });
