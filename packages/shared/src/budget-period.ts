// Phase 10: Budgets & Spending Targets — pure period-boundary calculator.
// Lives in packages/shared so the API alert worker, the web UI ("resets in
// 12 days" labels), and later the bot all use the same math.
// See docs/phase-10-budgets-design.md §2.1 and §4.
//
// Deliberately dependency-free: timezone math is done with
// Intl.DateTimeFormat only (no luxon/date-fns), matching the package's
// zero-dependency policy.

import type { BudgetPeriod } from './types/budget.types';

/** One resolved budget period window. Boundaries are half-open `[start, end)`. */
export interface ResolvedPeriod {
  /** UTC instant of the period start (inclusive). */
  start: Date;
  /** UTC instant of the period end (exclusive). */
  end: Date;
  /**
   * Local calendar date of the period start, `yyyy-mm-dd` — the
   * `budget_alert_events.period_key` dedup key (design §3).
   */
  periodKey: string;
}

export interface ResolvePeriodOptions {
  /**
   * Which period to resolve relative to the one containing `refDate`:
   * 0 (default) = current, −1 = previous, +1 = next. Used by
   * `GET /budgets/:id/progress?periods=N` history windows (design §5).
   * CUSTOM budgets do not repeat — a non-zero offset throws.
   */
  offset?: number;
  /** CUSTOM only: the budget's explicit `startsAt`, passed through unchanged. */
  customStart?: Date;
  /** CUSTOM only: the budget's explicit `endsAt`, passed through unchanged. */
  customEnd?: Date;
}

const MS_PER_DAY = 86_400_000;

/** Per-timezone formatter cache — the hourly worker resolves many budgets. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

interface LocalParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock date/time of a UTC instant in the given IANA timezone. */
function localParts(date: Date, timezone: string): LocalParts {
  const parts = getFormatter(timezone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * UTC-offset (ms) the timezone applies at the given UTC instant.
 *
 * Exported for the Phase 9 analytics engine, which converts it into a
 * `±HH:MM` string for SQL `CONVERT_TZ` period bucketing (design §2.5).
 */
export function tzOffsetMs(utcMs: number, timezone: string): number {
  const p = localParts(new Date(utcMs), timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

/**
 * UTC instant of local midnight for calendar date (year, month, day) in the
 * timezone. If midnight does not exist (a DST spring-forward crossing
 * 00:00), returns the first valid instant of that local day — both period
 * boundaries use the same convention, so `[start, end)` stays gapless.
 */
function zonedMidnightUtc(year: number, month: number, day: number, timezone: string): number {
  const wallClock = Date.UTC(year, month - 1, day);
  const offset1 = tzOffsetMs(wallClock, timezone);
  const candidate1 = wallClock - offset1;
  const offset2 = tzOffsetMs(candidate1, timezone);
  const candidate2 = wallClock - offset2;
  // Round-trip check: candidate2 maps back to exactly (y, m, d, 00:00)?
  if (tzOffsetMs(candidate2, timezone) === offset2) return candidate2;
  // Midnight was skipped — the later candidate is the moment just after the
  // transition (e.g. local 01:00 where clocks jumped 00:00 → 01:00).
  return Math.max(candidate1, candidate2);
}

/** Format a "local date as UTC ms" value to `yyyy-mm-dd`. */
function formatDateKey(localDateMs: number): string {
  const d = new Date(localDateMs);
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve the half-open `[start, end)` boundaries of the budget period
 * containing `refDate`, computed in the given IANA `timezone` (design §2.1):
 *
 * - `WEEKLY` — ISO 8601 week, Monday start;
 * - `MONTHLY` — calendar month;
 * - `QUARTERLY` — calendar quarter (Jan/Apr/Jul/Oct);
 * - `YEARLY` — calendar year;
 * - `CUSTOM` — passthrough of the budget's explicit `startsAt`/`endsAt`
 *   (never computed; CUSTOM budgets do not repeat).
 *
 * `options.offset` shifts to a previous (−N) or next (+N) period window.
 */
export function resolvePeriod(
  period: BudgetPeriod,
  refDate: Date,
  timezone: string,
  options: ResolvePeriodOptions = {},
): ResolvedPeriod {
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset)) {
    throw new Error(`resolvePeriod: offset must be an integer, got ${offset}`);
  }
  if (Number.isNaN(refDate.getTime())) {
    throw new Error('resolvePeriod: refDate is an invalid Date');
  }

  if (period === 'CUSTOM') {
    const { customStart, customEnd } = options;
    if (!customStart || !customEnd) {
      throw new Error('resolvePeriod: CUSTOM requires customStart and customEnd');
    }
    if (offset !== 0) {
      throw new Error('resolvePeriod: CUSTOM periods do not repeat — offset must be 0');
    }
    if (customStart.getTime() >= customEnd.getTime()) {
      throw new Error('resolvePeriod: customStart must be before customEnd');
    }
    const p = localParts(customStart, timezone);
    return {
      start: new Date(customStart.getTime()),
      end: new Date(customEnd.getTime()),
      periodKey: formatDateKey(Date.UTC(p.year, p.month - 1, p.day)),
    };
  }

  // Local calendar date of refDate, represented as a UTC-ms value so plain
  // Date.UTC arithmetic handles month/year rollover.
  const ref = localParts(refDate, timezone);
  let startLocal: number;
  let endLocal: number;

  switch (period) {
    case 'WEEKLY': {
      const refLocal = Date.UTC(ref.year, ref.month - 1, ref.day);
      // ISO 8601: weeks start Monday. getUTCDay(): 0 = Sunday.
      const daysFromMonday = (new Date(refLocal).getUTCDay() + 6) % 7;
      startLocal = refLocal - daysFromMonday * MS_PER_DAY + offset * 7 * MS_PER_DAY;
      endLocal = startLocal + 7 * MS_PER_DAY;
      break;
    }
    case 'MONTHLY': {
      startLocal = Date.UTC(ref.year, ref.month - 1 + offset, 1);
      endLocal = Date.UTC(ref.year, ref.month + offset, 1);
      break;
    }
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor((ref.month - 1) / 3) * 3;
      startLocal = Date.UTC(ref.year, quarterStartMonth + offset * 3, 1);
      endLocal = Date.UTC(ref.year, quarterStartMonth + offset * 3 + 3, 1);
      break;
    }
    case 'YEARLY': {
      startLocal = Date.UTC(ref.year + offset, 0, 1);
      endLocal = Date.UTC(ref.year + offset + 1, 0, 1);
      break;
    }
    default:
      throw new Error(`resolvePeriod: unknown period '${String(period)}'`);
  }

  const startParts = new Date(startLocal);
  const endParts = new Date(endLocal);
  return {
    start: new Date(
      zonedMidnightUtc(
        startParts.getUTCFullYear(),
        startParts.getUTCMonth() + 1,
        startParts.getUTCDate(),
        timezone,
      ),
    ),
    end: new Date(
      zonedMidnightUtc(
        endParts.getUTCFullYear(),
        endParts.getUTCMonth() + 1,
        endParts.getUTCDate(),
        timezone,
      ),
    ),
    periodKey: formatDateKey(startLocal),
  };
}
