'use client';

// Phase 20 · Iteration 20.1 — THE card shell: the border + surface + radius
// combination that 34 places wrote by hand. `as` lets a list render
// `<Card as="li">` without an extra wrapper.

import type { ElementType, HTMLAttributes, ReactNode, Ref } from 'react';
import { borderClass, cx, surfaceClass } from './styles';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export interface CardClassOptions {
  padding?: CardPadding;
  /** Page-background surface instead of the raised one (nested blocks). */
  muted?: boolean;
  className?: string;
}

/** The shell as a class string — for the few elements `<Card>` cannot be
 * (`<details>`, a `<Link>`). Everything else uses the component. */
export function cardClass({
  padding = 'md',
  muted = false,
  className = '',
}: CardClassOptions = {}) {
  return cx(
    'rounded-lg',
    borderClass,
    muted ? 'bg-gray-50 dark:bg-gray-900/40' : surfaceClass,
    PADDING[padding],
    className,
  );
}

export interface CardProps extends HTMLAttributes<HTMLElement>, CardClassOptions {
  as?: ElementType;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
}

export function Card({
  as,
  padding = 'md',
  muted = false,
  className = '',
  children,
  ...props
}: CardProps) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={cardClass({ padding, muted, className })} {...props}>
      {children}
    </Tag>
  );
}
