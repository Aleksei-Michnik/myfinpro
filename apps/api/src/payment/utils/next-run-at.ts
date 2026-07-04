import { parseExpression } from 'cron-parser';

/**
 * Schedule spec — exactly one of `cron` / `everyMs` is non-null. Mirrors the
 * `payment_schedules` row contract written by `PaymentScheduleService`.
 */
export type ScheduleSpec = {
  cron?: string | null;
  everyMs?: number | null;
};

/**
 * Compute the next BullMQ-equivalent firing time for a `PaymentSchedule`,
 * given the time the scheduler most recently fired (or its `startsAt` if
 * it has never fired yet).
 *
 * - cron: delegate to `cron-parser` with `currentDate = lastRunAt` (UTC).
 * - everyMs: simple `lastRunAt + everyMs`.
 *
 * Returns `null` when the spec is invalid or both fields are absent — the
 * caller should treat that as "leave nextRunAt untouched".
 *
 * Shared between
 * [`PaymentOccurrenceProcessor`](../payment-occurrence.processor.ts:1) and
 * [`PaymentScheduleService`](../payment-schedule.service.ts:1) so the value
 * persisted on create/replace and the value updated on every firing come
 * from one source.
 */
export function computeNextRunAt(spec: ScheduleSpec, lastRunAt: Date): Date | null {
  if (spec.cron) {
    try {
      const it = parseExpression(spec.cron, { currentDate: lastRunAt, tz: 'UTC' });
      return it.next().toDate();
    } catch {
      return null;
    }
  }
  if (typeof spec.everyMs === 'number' && spec.everyMs > 0) {
    return new Date(lastRunAt.getTime() + spec.everyMs);
  }
  return null;
}
