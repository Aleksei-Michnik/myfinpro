// Phase 10, iteration 10.1 — resolvePeriod() boundary calculator.
// Boundaries are half-open [start, end) computed in the budget timezone
// (docs/phase-10-budgets-design.md §2.1, §4). Timezone facts used below:
//   Asia/Jerusalem 2026 — IDT (UTC+3) starts Fri 2026-03-27 02:00,
//     ends Sun 2026-10-25 02:00 (back to UTC+2).
//   America/New_York 2026 — EDT starts Sun 2026-03-08, ends Sun 2026-11-01.
//   Pacific/Apia — skipped Fri 2011-12-30 entirely (UTC-10 → UTC+14).

import { describe, it, expect } from 'vitest';
import { resolvePeriod, type ResolvedPeriod } from '../budget-period';
import { BUDGET_PERIODS, type BudgetPeriod } from '../types/budget.types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const iso = (r: ResolvedPeriod) => ({
  start: r.start.toISOString(),
  end: r.end.toISOString(),
  key: r.periodKey,
});

describe('resolvePeriod — MONTHLY', () => {
  it('resolves a calendar month in UTC', () => {
    const r = resolvePeriod('MONTHLY', new Date('2026-07-15T12:00:00Z'), 'UTC');
    expect(iso(r)).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
      key: '2026-07-01',
    });
  });

  it('uses the LOCAL calendar day in Asia/Jerusalem (UTC evening = local next month)', () => {
    // 2026-06-30T21:30Z is already 2026-07-01 00:30 IDT → July period.
    const r = resolvePeriod('MONTHLY', new Date('2026-06-30T21:30:00Z'), 'Asia/Jerusalem');
    expect(iso(r)).toEqual({
      start: '2026-06-30T21:00:00.000Z', // 2026-07-01 00:00 IDT
      end: '2026-07-31T21:00:00.000Z', // 2026-08-01 00:00 IDT
      key: '2026-07-01',
    });
    // One hour earlier it is still 23:30 June 30 local → June period.
    const june = resolvePeriod('MONTHLY', new Date('2026-06-30T20:30:00Z'), 'Asia/Jerusalem');
    expect(june.periodKey).toBe('2026-06-01');
    expect(june.end.toISOString()).toBe('2026-06-30T21:00:00.000Z');
  });

  it('crosses the Jerusalem spring-forward (March 2026 is 1h shorter)', () => {
    const r = resolvePeriod('MONTHLY', new Date('2026-03-15T12:00:00Z'), 'Asia/Jerusalem');
    expect(iso(r)).toEqual({
      start: '2026-02-28T22:00:00.000Z', // 2026-03-01 00:00 IST (+2)
      end: '2026-03-31T21:00:00.000Z', // 2026-04-01 00:00 IDT (+3)
      key: '2026-03-01',
    });
    expect(r.end.getTime() - r.start.getTime()).toBe(31 * DAY - HOUR);
  });

  it('crosses the Jerusalem fall-back (October 2026 is 1h longer)', () => {
    const r = resolvePeriod('MONTHLY', new Date('2026-10-10T12:00:00Z'), 'Asia/Jerusalem');
    expect(iso(r)).toEqual({
      start: '2026-09-30T21:00:00.000Z', // 2026-10-01 00:00 IDT (+3)
      end: '2026-10-31T22:00:00.000Z', // 2026-11-01 00:00 IST (+2)
      key: '2026-10-01',
    });
    expect(r.end.getTime() - r.start.getTime()).toBe(31 * DAY + HOUR);
  });

  it('crosses the America/New_York DST transitions (March + November 2026)', () => {
    const march = resolvePeriod('MONTHLY', new Date('2026-03-20T12:00:00Z'), 'America/New_York');
    expect(march.start.toISOString()).toBe('2026-03-01T05:00:00.000Z'); // EST (−5)
    expect(march.end.toISOString()).toBe('2026-04-01T04:00:00.000Z'); // EDT (−4)
    const nov = resolvePeriod('MONTHLY', new Date('2026-11-15T12:00:00Z'), 'America/New_York');
    expect(nov.start.toISOString()).toBe('2026-11-01T04:00:00.000Z'); // still EDT at midnight
    expect(nov.end.toISOString()).toBe('2026-12-01T05:00:00.000Z'); // EST
  });
});

describe('resolvePeriod — WEEKLY (ISO 8601, Monday start)', () => {
  it('resolves the Monday-anchored week of a Saturday', () => {
    // 2026-07-04 is a Saturday.
    const r = resolvePeriod('WEEKLY', new Date('2026-07-04T17:34:00Z'), 'UTC');
    expect(iso(r)).toEqual({
      start: '2026-06-29T00:00:00.000Z',
      end: '2026-07-06T00:00:00.000Z',
      key: '2026-06-29',
    });
  });

  it('keeps Sunday in the week of the PREVIOUS Monday', () => {
    // 2026-07-05 is a Sunday → still the 06-29 week.
    const sunday = resolvePeriod('WEEKLY', new Date('2026-07-05T10:00:00Z'), 'UTC');
    expect(sunday.periodKey).toBe('2026-06-29');
    // Monday 00:00 starts the next week (half-open boundary).
    const monday = resolvePeriod('WEEKLY', new Date('2026-07-06T00:00:00Z'), 'UTC');
    expect(monday.periodKey).toBe('2026-07-06');
  });

  it('crosses the year boundary (2026-01-01 is a Thursday of week 2025-12-29)', () => {
    const r = resolvePeriod('WEEKLY', new Date('2026-01-01T12:00:00Z'), 'UTC');
    expect(iso(r)).toEqual({
      start: '2025-12-29T00:00:00.000Z',
      end: '2026-01-05T00:00:00.000Z',
      key: '2025-12-29',
    });
  });

  it('handles ISO week 53 (2021-01-02 belongs to week 53 of 2020)', () => {
    const r = resolvePeriod('WEEKLY', new Date('2021-01-02T12:00:00Z'), 'UTC');
    expect(iso(r)).toEqual({
      start: '2020-12-28T00:00:00.000Z',
      end: '2021-01-04T00:00:00.000Z',
      key: '2020-12-28',
    });
  });

  it('picks the week from the LOCAL weekday, not the UTC one', () => {
    // 2026-07-05T22:00Z is Sunday in UTC but already Monday 01:00 in Jerusalem.
    const jerusalem = resolvePeriod('WEEKLY', new Date('2026-07-05T22:00:00Z'), 'Asia/Jerusalem');
    expect(jerusalem.periodKey).toBe('2026-07-06');
    expect(jerusalem.start.toISOString()).toBe('2026-07-05T21:00:00.000Z'); // Mon 00:00 IDT
    const utc = resolvePeriod('WEEKLY', new Date('2026-07-05T22:00:00Z'), 'UTC');
    expect(utc.periodKey).toBe('2026-06-29');
  });

  it('is 1h short across the New York spring-forward week', () => {
    // Sunday 2026-03-08 (DST start) sits in the Mon 03-02 … Mon 03-09 week.
    const r = resolvePeriod('WEEKLY', new Date('2026-03-08T18:00:00Z'), 'America/New_York');
    expect(r.start.toISOString()).toBe('2026-03-02T05:00:00.000Z'); // Mon 00:00 EST
    expect(r.end.toISOString()).toBe('2026-03-09T04:00:00.000Z'); // Mon 00:00 EDT
    expect(r.end.getTime() - r.start.getTime()).toBe(7 * DAY - HOUR);
  });

  it('survives Pacific/Apia skipping 2011-12-30 entirely (6-day week)', () => {
    // Samoa jumped from UTC−10 to UTC+14; Friday 2011-12-30 never existed.
    const r = resolvePeriod('WEEKLY', new Date('2011-12-28T00:00:00Z'), 'Pacific/Apia');
    expect(iso(r)).toEqual({
      start: '2011-12-26T10:00:00.000Z', // Mon 2011-12-26 00:00 (−10)
      end: '2012-01-01T10:00:00.000Z', // Mon 2012-01-02 00:00 (+14)
      key: '2011-12-26',
    });
    expect(r.end.getTime() - r.start.getTime()).toBe(6 * DAY);
  });
});

describe('resolvePeriod — QUARTERLY', () => {
  it('resolves calendar quarters in UTC', () => {
    const q2 = resolvePeriod('QUARTERLY', new Date('2026-05-20T00:00:00Z'), 'UTC');
    expect(iso(q2)).toEqual({
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-07-01T00:00:00.000Z',
      key: '2026-04-01',
    });
    // Half-open: the quarter boundary instant belongs to the NEW quarter.
    const q3 = resolvePeriod('QUARTERLY', new Date('2026-07-01T00:00:00Z'), 'UTC');
    expect(q3.periodKey).toBe('2026-07-01');
    expect(q3.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('resolves Q1 2026 in Asia/Jerusalem across the DST start', () => {
    const r = resolvePeriod('QUARTERLY', new Date('2026-02-14T12:00:00Z'), 'Asia/Jerusalem');
    expect(iso(r)).toEqual({
      start: '2025-12-31T22:00:00.000Z', // 2026-01-01 00:00 IST (+2)
      end: '2026-03-31T21:00:00.000Z', // 2026-04-01 00:00 IDT (+3)
      key: '2026-01-01',
    });
  });
});

describe('resolvePeriod — YEARLY', () => {
  it('resolves the calendar year in UTC', () => {
    const r = resolvePeriod('YEARLY', new Date('2026-07-04T17:34:00Z'), 'UTC');
    expect(iso(r)).toEqual({
      start: '2026-01-01T00:00:00.000Z',
      end: '2027-01-01T00:00:00.000Z',
      key: '2026-01-01',
    });
  });

  it('resolves the calendar year in Asia/Jerusalem (IST at both boundaries)', () => {
    const r = resolvePeriod('YEARLY', new Date('2026-07-04T17:34:00Z'), 'Asia/Jerusalem');
    expect(iso(r)).toEqual({
      start: '2025-12-31T22:00:00.000Z', // 2026-01-01 00:00 IST
      end: '2026-12-31T22:00:00.000Z', // 2027-01-01 00:00 IST
      key: '2026-01-01',
    });
  });
});

describe('resolvePeriod — offset (previous / next periods)', () => {
  it('offset −1 gives the previous month across a year boundary', () => {
    const r = resolvePeriod('MONTHLY', new Date('2026-01-15T12:00:00Z'), 'UTC', { offset: -1 });
    expect(iso(r)).toEqual({
      start: '2025-12-01T00:00:00.000Z',
      end: '2026-01-01T00:00:00.000Z',
      key: '2025-12-01',
    });
  });

  it('offset −1 gives the previous ISO week across a year boundary', () => {
    const r = resolvePeriod('WEEKLY', new Date('2026-01-01T12:00:00Z'), 'UTC', { offset: -1 });
    expect(r.periodKey).toBe('2025-12-22');
    expect(r.end.toISOString()).toBe('2025-12-29T00:00:00.000Z');
  });

  it('offset +1 from Q4 lands in Q1 of the next year', () => {
    const r = resolvePeriod('QUARTERLY', new Date('2026-11-15T12:00:00Z'), 'UTC', { offset: 1 });
    expect(r.periodKey).toBe('2027-01-01');
    expect(r.end.toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });

  it('offset −1 gives the previous year', () => {
    const r = resolvePeriod('YEARLY', new Date('2026-07-04T00:00:00Z'), 'UTC', { offset: -1 });
    expect(r.periodKey).toBe('2025-01-01');
  });

  it('the last N monthly windows are contiguous in Asia/Jerusalem (10.5 history bars)', () => {
    const ref = new Date('2026-07-04T17:34:00Z');
    const windows = [-5, -4, -3, -2, -1, 0].map((offset) =>
      resolvePeriod('MONTHLY', ref, 'Asia/Jerusalem', { offset }),
    );
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i - 1].end.getTime()).toBe(windows[i].start.getTime());
    }
    expect(windows[0].periodKey).toBe('2026-02-01');
    expect(windows[5].periodKey).toBe('2026-07-01');
  });
});

describe('resolvePeriod — half-open [start, end) semantics', () => {
  it.each(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const)(
    '%s: previous period end === current period start, and start ≤ ref < end',
    (period) => {
      const ref = new Date('2026-07-04T17:34:00Z');
      for (const timezone of ['UTC', 'Asia/Jerusalem', 'America/New_York']) {
        const current = resolvePeriod(period, ref, timezone);
        const previous = resolvePeriod(period, ref, timezone, { offset: -1 });
        expect(previous.end.getTime()).toBe(current.start.getTime());
        expect(current.start.getTime()).toBeLessThanOrEqual(ref.getTime());
        expect(ref.getTime()).toBeLessThan(current.end.getTime());
      }
    },
  );

  it('an instant exactly on a local month boundary belongs to the NEW period', () => {
    // Exactly 2026-07-01 00:00:00 IDT.
    const boundary = new Date('2026-06-30T21:00:00.000Z');
    expect(resolvePeriod('MONTHLY', boundary, 'Asia/Jerusalem').periodKey).toBe('2026-07-01');
    const justBefore = new Date(boundary.getTime() - 1);
    expect(resolvePeriod('MONTHLY', justBefore, 'Asia/Jerusalem').periodKey).toBe('2026-06-01');
  });
});

describe('resolvePeriod — CUSTOM (passthrough of budget startsAt/endsAt)', () => {
  const customStart = new Date('2026-06-30T21:00:00.000Z'); // 2026-07-01 local IDT
  const customEnd = new Date('2026-08-15T21:00:00.000Z');

  it('passes the explicit bounds through unchanged', () => {
    const r = resolvePeriod('CUSTOM', new Date('2026-07-10T00:00:00Z'), 'Asia/Jerusalem', {
      customStart,
      customEnd,
    });
    expect(r.start.getTime()).toBe(customStart.getTime());
    expect(r.end.getTime()).toBe(customEnd.getTime());
    // periodKey is the LOCAL calendar date of the custom start.
    expect(r.periodKey).toBe('2026-07-01');
  });

  it('throws without both custom bounds', () => {
    expect(() => resolvePeriod('CUSTOM', new Date(), 'UTC')).toThrow(/customStart and customEnd/);
    expect(() => resolvePeriod('CUSTOM', new Date(), 'UTC', { customStart })).toThrow(
      /customStart and customEnd/,
    );
  });

  it('throws when customStart is not before customEnd', () => {
    expect(() =>
      resolvePeriod('CUSTOM', new Date(), 'UTC', {
        customStart: customEnd,
        customEnd: customStart,
      }),
    ).toThrow(/before/);
  });

  it('throws on a non-zero offset — CUSTOM does not repeat', () => {
    expect(() =>
      resolvePeriod('CUSTOM', new Date(), 'UTC', { customStart, customEnd, offset: -1 }),
    ).toThrow(/do not repeat/);
  });
});

describe('resolvePeriod — validation and periodKey format', () => {
  it('throws on an invalid refDate', () => {
    expect(() => resolvePeriod('MONTHLY', new Date(NaN), 'UTC')).toThrow(/invalid Date/);
  });

  it('throws on a non-integer offset', () => {
    expect(() => resolvePeriod('MONTHLY', new Date(), 'UTC', { offset: 0.5 })).toThrow(/integer/);
  });

  it('throws on an unknown period value', () => {
    expect(() => resolvePeriod('DAILY' as BudgetPeriod, new Date(), 'UTC')).toThrow(
      /unknown period/,
    );
  });

  it('throws on an invalid IANA timezone', () => {
    expect(() => resolvePeriod('MONTHLY', new Date(), 'Not/AZone')).toThrow(RangeError);
  });

  it('periodKey is always yyyy-mm-dd of the period start', () => {
    const ref = new Date('2026-07-04T17:34:00Z');
    for (const period of BUDGET_PERIODS.filter((p) => p !== 'CUSTOM')) {
      const r = resolvePeriod(period, ref, 'Asia/Jerusalem');
      expect(r.periodKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
