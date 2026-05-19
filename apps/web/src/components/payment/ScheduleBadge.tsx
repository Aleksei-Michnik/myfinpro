'use client';

// Phase 6 · Iteration 6.18.1 — read-only schedule badge for the payment
// detail page. Lifecycle controls (pause / resume / cancel) ship in 6.18.2.

import { useTranslations } from 'next-intl';
import { humanReadableRepeat } from '@/lib/payment/schedule-formatters';
import { deriveScheduleStatus, type ScheduleResponse } from '@/lib/payment/types';

export interface ScheduleBadgeProps {
  schedule: ScheduleResponse;
  /** Locale code, used by `Intl.DateTimeFormat` for the relative-run text. */
  locale?: string;
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

export function ScheduleBadge({ schedule, locale = 'en' }: ScheduleBadgeProps) {
  const t = useTranslations('payments.schedule.badge');
  const status = deriveScheduleStatus(schedule) ?? 'active';

  const statusKey =
    status === 'active' ? 'statusActive' : status === 'paused' ? 'statusPaused' : 'statusCancelled';

  const repeat = humanReadableRepeat(schedule, t);
  const isCron = !!schedule.cron;

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      aria-labelledby="schedule-badge-title"
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
    </section>
  );
}
