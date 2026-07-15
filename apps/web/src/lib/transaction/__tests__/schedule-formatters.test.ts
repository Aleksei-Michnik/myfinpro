// Phase 6 · Iteration 6.18.1 — coverage for the humanReadableRepeat
// formatter that backs `<ScheduleBadge>` and the form's inline summary.

import { describe, expect, it } from 'vitest';
import { decomposeEveryMs, humanReadableRepeat } from '../schedule-formatters';

/** Identity-key formatter: stringifies the key + interpolated values. */
const t = (key: string, values?: Record<string, string | number>): string => {
  if (!values) return key;
  const parts = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  return `${key}(${parts.join(',')})`;
};

describe('decomposeEveryMs', () => {
  it('picks months when divisible by 30 days', () => {
    expect(decomposeEveryMs(30 * 24 * 60 * 60_000)).toEqual({ unit: 'months', count: 1 });
  });

  it('picks weeks for 7 days', () => {
    expect(decomposeEveryMs(7 * 24 * 60 * 60_000)).toEqual({ unit: 'weeks', count: 1 });
  });

  it('picks days for 86_400_000', () => {
    expect(decomposeEveryMs(86_400_000)).toEqual({ unit: 'days', count: 1 });
  });

  it('picks hours for 3_600_000', () => {
    expect(decomposeEveryMs(3_600_000)).toEqual({ unit: 'hours', count: 1 });
  });

  it('picks minutes for 60_000', () => {
    expect(decomposeEveryMs(60_000)).toEqual({ unit: 'minutes', count: 1 });
  });

  it('falls back to minutes for non-aligned values', () => {
    // 90 minutes — not divisible by an hour.
    expect(decomposeEveryMs(90 * 60_000)).toEqual({ unit: 'minutes', count: 90 });
  });
});

describe('humanReadableRepeat', () => {
  it('renders cron verbatim via repeatCron', () => {
    expect(humanReadableRepeat({ cron: '0 9 * * 1', everyMs: null }, t)).toBe(
      'repeatCron(expr=0 9 * * 1)',
    );
  });

  it('renders every-15-minutes via repeatEveryMinutes', () => {
    expect(humanReadableRepeat({ cron: null, everyMs: 15 * 60_000 }, t)).toBe(
      'repeatEveryMinutes(n=15)',
    );
  });

  it('renders every-1-day via repeatEveryDays', () => {
    expect(humanReadableRepeat({ cron: null, everyMs: 86_400_000 }, t)).toBe(
      'repeatEveryDays(n=1)',
    );
  });

  it('renders every-2-weeks via repeatEveryWeeks', () => {
    expect(humanReadableRepeat({ cron: null, everyMs: 14 * 24 * 60 * 60_000 }, t)).toBe(
      'repeatEveryWeeks(n=2)',
    );
  });

  it('renders every-1-month via repeatEveryMonths (≈30 days)', () => {
    expect(humanReadableRepeat({ cron: null, everyMs: 30 * 24 * 60 * 60_000 }, t)).toBe(
      'repeatEveryMonths(n=1)',
    );
  });

  it('renders empty string for malformed schedule (no cron, zero everyMs)', () => {
    expect(humanReadableRepeat({ cron: null, everyMs: 0 }, t)).toBe('');
  });
});
