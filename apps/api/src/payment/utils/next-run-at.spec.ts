import { computeNextRunAt } from './next-run-at';

describe('computeNextRunAt', () => {
  it('cron schedule advances to the next slot', () => {
    const lastRunAt = new Date('2026-05-16T12:30:00.000Z');
    const next = computeNextRunAt({ cron: '*/15 * * * *' }, lastRunAt);
    expect(next?.toISOString()).toBe('2026-05-16T12:45:00.000Z');
  });

  it('cron crossing the hour boundary', () => {
    const lastRunAt = new Date('2026-05-16T12:46:00.000Z');
    const next = computeNextRunAt({ cron: '*/15 * * * *' }, lastRunAt);
    expect(next?.toISOString()).toBe('2026-05-16T13:00:00.000Z');
  });

  it('everyMs adds the interval', () => {
    const lastRunAt = new Date('2026-05-16T12:30:00.000Z');
    const next = computeNextRunAt({ everyMs: 60_000 }, lastRunAt);
    expect(next?.toISOString()).toBe('2026-05-16T12:31:00.000Z');
  });

  it('everyMs with a one-day interval', () => {
    const lastRunAt = new Date('2026-05-16T00:00:00.000Z');
    const next = computeNextRunAt({ everyMs: 24 * 60 * 60 * 1000 }, lastRunAt);
    expect(next?.toISOString()).toBe('2026-05-17T00:00:00.000Z');
  });

  it('returns null when neither cron nor everyMs is provided', () => {
    expect(computeNextRunAt({}, new Date())).toBeNull();
  });

  it('returns null when both are nullish', () => {
    expect(computeNextRunAt({ cron: null, everyMs: null }, new Date())).toBeNull();
  });

  it('returns null on an invalid cron expression', () => {
    expect(computeNextRunAt({ cron: 'not a cron' }, new Date())).toBeNull();
  });

  it('returns null when everyMs is non-positive', () => {
    expect(computeNextRunAt({ everyMs: 0 }, new Date())).toBeNull();
    expect(computeNextRunAt({ everyMs: -1 }, new Date())).toBeNull();
  });

  it('cron prevails when both are provided (everyMs ignored)', () => {
    const lastRunAt = new Date('2026-05-16T12:30:00.000Z');
    const next = computeNextRunAt({ cron: '*/15 * * * *', everyMs: 60_000 }, lastRunAt);
    expect(next?.toISOString()).toBe('2026-05-16T12:45:00.000Z');
  });
});
