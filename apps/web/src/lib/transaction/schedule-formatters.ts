// Phase 6 · Iteration 6.18.1 — pure formatting helpers for `<ScheduleBadge>`
// + the schedule sub-form's inline summary. Side-effect free; consumes a
// next-intl `t` function (relative to the `transactions.schedule.badge`
// namespace) so the helpers stay testable without mounting React.

import type { ScheduleResponse, ScheduleSpec } from './types';

/** Snapshot of the inputs a humanReadable formatter actually needs. */
export type RepeatSummaryInput = Pick<ScheduleResponse, 'cron' | 'everyMs'> | ScheduleSpec;

/** Best-fit unit for the everyMs pretty-printer. */
type EveryUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

interface EveryDecomposition {
  unit: EveryUnit;
  count: number;
}

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const MS_WEEK = 7 * MS_DAY;
const MS_MONTH_APPROX = 30 * MS_DAY;

/**
 * Pick the "biggest" unit that exactly divides the supplied `everyMs`.
 * Falls back to minutes for sub-minute values (the API rejects those in
 * production but the helper stays defensive for edge cases).
 */
export function decomposeEveryMs(everyMs: number): EveryDecomposition {
  if (everyMs <= 0 || !Number.isFinite(everyMs)) return { unit: 'minutes', count: 0 };
  if (everyMs % MS_MONTH_APPROX === 0) return { unit: 'months', count: everyMs / MS_MONTH_APPROX };
  if (everyMs % MS_WEEK === 0) return { unit: 'weeks', count: everyMs / MS_WEEK };
  if (everyMs % MS_DAY === 0) return { unit: 'days', count: everyMs / MS_DAY };
  if (everyMs % MS_HOUR === 0) return { unit: 'hours', count: everyMs / MS_HOUR };
  return { unit: 'minutes', count: Math.max(1, Math.round(everyMs / MS_MINUTE)) };
}

/**
 * Humanise a schedule's repeat shape into a single sentence.
 *
 *   { everyMs: 60_000 } / "en" → "Every 1 minute(s)"
 *   { everyMs: 86_400_000 }    → "Every 1 day(s)"
 *   { cron: '0 9 * * 1' }      → "Cron: 0 9 * * 1"
 *
 * `t` is a `useTranslations('transactions.schedule.badge')` function — it must
 * resolve `repeatEveryMinutes / Hours / Days / Weeks / Months / Cron` keys
 * with `{ n }` or `{ expr }` placeholders.
 */
export function humanReadableRepeat(
  schedule: RepeatSummaryInput,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const cron = schedule.cron ?? null;
  const everyMs = schedule.everyMs ?? null;
  if (cron) return t('repeatCron', { expr: cron });
  if (typeof everyMs !== 'number' || everyMs <= 0) {
    // Defensive: malformed schedule — render an empty string rather than
    // a confusing "Every 0 minutes".
    return '';
  }
  const { unit, count } = decomposeEveryMs(everyMs);
  switch (unit) {
    case 'months':
      return t('repeatEveryMonths', { n: count });
    case 'weeks':
      return t('repeatEveryWeeks', { n: count });
    case 'days':
      return t('repeatEveryDays', { n: count });
    case 'hours':
      return t('repeatEveryHours', { n: count });
    case 'minutes':
    default:
      return t('repeatEveryMinutes', { n: count });
  }
}
