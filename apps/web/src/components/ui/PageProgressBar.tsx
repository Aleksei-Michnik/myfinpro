'use client';

// Phase 6 · Iteration 6.16.3 — singleton top page progress bar.
// Mounted once in [locale]/layout.tsx inside <UIStatusProvider>.
// Determinate semantics — drives off `useNavProgress()` from ui-status-context:
// 100 ms debounced visibility, 0 → 90 asymptotic progress, snap to 100 on
// completion + 200 ms fade. Sticky to viewport top, blue (tailwind blue-500),
// 3 px high, z-index 9999. RTL-aware (transform-origin flips). Honours
// `prefers-reduced-motion` via globals.css.

import { useTranslations } from 'next-intl';
import { useNavProgress } from '@/lib/ui';

export interface PageProgressBarProps {
  /** Optional override for the aria-label; defaults to `t('ui.loading.pageProgressLabel')`. */
  label?: string;
}

export function PageProgressBar({ label }: PageProgressBarProps = {}) {
  const t = useTranslations('ui.loading');
  const { visible, progress } = useNavProgress();
  const ariaLabel = label ?? t('pageProgressLabel');
  // Snap progress to nearest integer for the aria-valuenow attribute.
  const ariaProgress = Math.max(0, Math.min(100, Math.round(progress)));
  // The fill is rendered via a CSS transform: scaleX(progress/100).
  const scaleX = Math.max(0, Math.min(100, progress)) / 100;
  // While progress is 100 and we're fading out, dim the bar via opacity.
  const isFading = progress >= 99.5;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ariaProgress}
      aria-label={ariaLabel}
      aria-hidden={!visible}
      data-testid="page-progress-bar"
      data-active={visible}
      data-progress={ariaProgress}
      hidden={!visible}
      style={{ height: '3px' }}
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] overflow-hidden"
    >
      <div
        data-testid="page-progress-bar-fill"
        className={`mfp-progress-bar h-full w-full bg-blue-500${isFading ? ' is-fading' : ''}`}
        style={{ transform: `scaleX(${scaleX})` }}
      />
    </div>
  );
}
