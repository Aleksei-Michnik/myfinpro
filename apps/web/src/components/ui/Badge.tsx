'use client';

// Phase 20 · Iteration 20.1 — THE chip: scope, category, status and count
// pills. One tone scale, both colour schemes, no per-surface colour strings.

import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './styles';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type BadgeSize = 'sm' | 'md';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  primary: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-xs',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  children: ReactNode;
}

export function Badge({
  tone = 'neutral',
  size = 'sm',
  className = '',
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full font-medium',
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
