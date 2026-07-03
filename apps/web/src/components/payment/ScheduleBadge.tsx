'use client';

// Phase 6 · Iteration 6.18.1 — schedule badge for the payment detail page.
// Iteration 6.18.2 adds the lifecycle controls (pause / resume / cancel):
// the badge stays presentational — the async submit and the resulting
// schedule state live in the caller; `pending` drives the disabled state.
// Cancel is terminal on the API, so it goes through an inline two-step
// confirm before `onCancel` fires.

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { humanReadableRepeat } from '@/lib/payment/schedule-formatters';
import { deriveScheduleStatus, type ScheduleResponse } from '@/lib/payment/types';

export interface ScheduleBadgeProps {
  schedule: ScheduleResponse;
  /** Locale code, used by `Intl.DateTimeFormat` for the relative-run text. */
  locale?: string;
  /**
   * Lifecycle controls render only when true (the API is creator-only —
   * mirroring `PaymentDetailHeader`'s edit gating).
   */
  canManage?: boolean;
  /** Disables the lifecycle buttons while an action is in flight. */
  pending?: boolean;
  onPause?(): void;
  onResume?(): void;
  onCancel?(): void;
}

/** Format an ISO datetime → localised "Apr 25, 2026, 9:00 AM" style string. */
function formatWhen(iso: string | null, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const STATUS_PILL_CLASSES: Record<'active' | 'paused' | 'cancelled', string> = {
  active:
    'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800',
  paused:
    'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800',
  cancelled:
    'bg-gray-200 text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600',
};

const STATUS_DOT: Record<'active' | 'paused' | 'cancelled', string> = {
  active: '🟢',
  paused: '🟡',
  cancelled: '⚫',
};

export function ScheduleBadge({
  schedule,
  locale = 'en',
  canManage = false,
  pending = false,
  onPause,
  onResume,
  onCancel,
}: ScheduleBadgeProps) {
  const t = useTranslations('payments.schedule.badge');
  const status = deriveScheduleStatus(schedule) ?? 'active';
  // Inline two-step confirm for the terminal cancel action.
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Leaving the manageable state (action completed elsewhere, realtime echo,
  // permissions flip) discards a half-open confirm strip.
  useEffect(() => {
    if (!canManage || status === 'cancelled') setConfirmingCancel(false);
  }, [canManage, status]);

  const statusKey =
    status === 'active' ? 'statusActive' : status === 'paused' ? 'statusPaused' : 'statusCancelled';

  const repeat = humanReadableRepeat(schedule, t);
  const isCron = !!schedule.cron;

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      aria-labelledby="schedule-badge-title"
      // Realtime schedule lifecycle updates (created / paused / resumed /
      // cancelled / deleted) re-render this section. `aria-live=polite`
      // lets screen readers announce the change without interrupting the
      // user (Phase 6 · Iteration 6.18.1.4.3 a11y).
      aria-live="polite"
      aria-atomic="true"
      data-testid="schedule-badge"
      data-status={status}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3
          id="schedule-badge-title"
          className="text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          {t('title')}
        </h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_PILL_CLASSES[status]}`}
          data-testid="schedule-badge-status"
        >
          <span aria-hidden="true">{STATUS_DOT[status]}</span>
          <span>{t(statusKey)}</span>
        </span>
      </div>

      <p
        className={`text-sm text-gray-700 dark:text-gray-200 ${isCron ? 'font-mono' : ''}`}
        data-testid="schedule-badge-repeat"
      >
        {repeat}
      </p>

      {schedule.nextRunAt && status === 'active' && (
        <p
          className="mt-1 text-sm text-gray-700 dark:text-gray-200"
          data-testid="schedule-badge-next-run"
        >
          {t('nextRun', { when: formatWhen(schedule.nextRunAt, locale) })}
        </p>
      )}

      {schedule.lastRunAt && (
        <p
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
          data-testid="schedule-badge-last-run"
        >
          {t('lastRun', { when: formatWhen(schedule.lastRunAt, locale) })}
        </p>
      )}

      {status === 'cancelled' && schedule.cancelledAt && (
        <p
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
          data-testid="schedule-badge-cancelled-at"
        >
          {t('cancelledAt', { when: formatWhen(schedule.cancelledAt, locale) })}
        </p>
      )}

      {schedule.limit !== null && schedule.limit !== undefined && (
        <p
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
          data-testid="schedule-badge-limit"
        >
          {t('runsLimit', { n: schedule.limit })}
        </p>
      )}

      {/* Phase 6 · Iteration 6.18.2 — lifecycle controls. Cancelled is
          terminal, so the row disappears entirely in that state. */}
      {canManage && status !== 'cancelled' && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="schedule-actions">
          {status === 'active' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onPause}
              disabled={pending}
              data-testid="schedule-action-pause"
            >
              {t('pause')}
            </Button>
          )}
          {status === 'paused' && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onResume}
              disabled={pending}
              data-testid="schedule-action-resume"
            >
              {t('resume')}
            </Button>
          )}
          {!confirmingCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmingCancel(true)}
              disabled={pending}
              data-testid="schedule-action-cancel"
            >
              {t('cancelAction')}
            </Button>
          ) : (
            <span
              className="inline-flex flex-wrap items-center gap-2"
              data-testid="schedule-cancel-confirm"
            >
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {t('cancelConfirmBody')}
              </span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirmingCancel(false);
                  onCancel?.();
                }}
                disabled={pending}
                data-testid="schedule-cancel-confirm-yes"
              >
                {t('cancelConfirmYes')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmingCancel(false)}
                disabled={pending}
                data-testid="schedule-cancel-confirm-keep"
              >
                {t('cancelConfirmKeep')}
              </Button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
