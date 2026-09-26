'use client';

// Phase 20 · Iteration 20.1 — THE page heading row: title, optional
// description, optional actions. One title style (`text-2xl font-bold`, the
// majority) with a `lg` escape for the marketing / legal / auth pages.

import type { ReactNode } from 'react';
import { cx } from './styles';

export type PageHeaderSize = 'md' | 'lg';

const TITLE_SIZES: Record<PageHeaderSize, string> = {
  md: 'text-2xl font-bold',
  lg: 'text-3xl font-bold tracking-tight',
};

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons / links on the trailing side. */
  actions?: ReactNode;
  /** Small line above the title (brand, breadcrumb-like context). */
  eyebrow?: ReactNode;
  /** Heading level — `h1` per page, `h2` for a section that reuses the style. */
  as?: 'h1' | 'h2';
  size?: PageHeaderSize;
  /** Id on the heading, for `aria-labelledby`. */
  titleId?: string;
  className?: string;
  'data-testid'?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  as = 'h1',
  size = 'md',
  titleId,
  className = '',
  'data-testid': testId,
}: PageHeaderProps) {
  const Heading = as;
  return (
    <header
      className={cx('flex flex-wrap items-center justify-between gap-3', className)}
      data-testid={testId}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {eyebrow}
          </p>
        )}
        <Heading id={titleId} className={cx(TITLE_SIZES[size], 'text-gray-900 dark:text-gray-100')}>
          {title}
        </Heading>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
