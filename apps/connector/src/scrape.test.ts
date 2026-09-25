import { describe, expect, it } from 'vitest';
import { EXIT_SCRAPE } from './errors.js';
import { defaultStartDate, parseSince, DEFAULT_SINCE_DAYS } from './scrape.js';

// The scraping itself is never exercised here: a test that logs in to a real
// bank is out of scope (design §3.5). Only the date arithmetic around it is.

describe('defaultStartDate', () => {
  it('goes back 60 days, to local midnight', () => {
    const start = defaultStartDate(new Date(2026, 8, 25, 14, 12, 3));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(27);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect(DEFAULT_SINCE_DAYS).toBe(60);
  });
});

describe('parseSince', () => {
  it('reads a calendar date as local midnight', () => {
    const since = parseSince(' 2026-09-01 ');
    expect([since.getFullYear(), since.getMonth(), since.getDate()]).toEqual([2026, 8, 1]);
  });

  it('refuses anything that is not a real yyyy-mm-dd', () => {
    for (const value of ['01/09/2026', '2026-9-1', '2026-02-31', 'yesterday']) {
      expect(() => parseSince(value)).toThrowError(
        expect.objectContaining({ exitCode: EXIT_SCRAPE }) as unknown as Error,
      );
    }
  });
});
