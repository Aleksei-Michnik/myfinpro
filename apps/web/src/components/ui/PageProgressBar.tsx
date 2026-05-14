'use client';

// Phase 6 · Iteration 6.16.2 — singleton top progress bar.
// Mounted once in [locale]/layout.tsx inside <UIStatusProvider>.
// Drives off `useUIStatus().activePageOps`. Indeterminate animation;
// honours prefers-reduced-motion via globals.css.

import { useTranslations } from 'next-intl';
import { useUIStatus } from '@/lib/ui';

export interface PageProgressBarProps {
  /** Optional override for the aria-label; defaults to `t('ui.loading.pageProgressLabel')`. */
  label?: string;
}

export function PageProgressBar({ label }: PageProgressBarProps = {}) {
  const t = useTranslations('ui.loading');
  const { activePageOps } = useUIStatus();
  const active = activePageOps > 0;
  const ariaLabel = label ?? t('pageProgressLabel');

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      aria-hidden={!active}
      data-testid="page-progress-bar"
      data-active={active}
      hidden={!active}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div
        data-testid="page-progress-bar-fill"
        className="mfp-progress-bar h-full w-full bg-primary-500"
      />
    </div>
  );
}
