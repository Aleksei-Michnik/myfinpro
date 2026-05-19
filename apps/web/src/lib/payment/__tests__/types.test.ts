// Phase 6 · Iteration 6.18.1 — truth-table coverage for the
// `deriveScheduleStatus` helper. The ordering rule (`cancelledAt` wins
// over `pausedAt`) is exercised explicitly so a regression flips the
// badge colour pill.

import { describe, expect, it } from 'vitest';
import { deriveScheduleStatus, type ScheduleResponse } from '../types';

function s(partial: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 's-1',
    paymentId: 'p-1',
    cron: null,
    everyMs: 60_000,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: null,
    limit: null,
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    cancelledAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('deriveScheduleStatus', () => {
  it('null schedule → null status', () => {
    expect(deriveScheduleStatus(null)).toBeNull();
  });

  it('no pausedAt and no cancelledAt → active', () => {
    expect(deriveScheduleStatus(s())).toBe('active');
  });

  it('pausedAt set → paused', () => {
    expect(deriveScheduleStatus(s({ pausedAt: '2026-01-02T00:00:00Z' }))).toBe('paused');
  });

  it('cancelledAt set → cancelled', () => {
    expect(deriveScheduleStatus(s({ cancelledAt: '2026-01-02T00:00:00Z' }))).toBe('cancelled');
  });

  it('cancelledAt wins over pausedAt (terminal precedence)', () => {
    expect(
      deriveScheduleStatus(
        s({ pausedAt: '2026-01-02T00:00:00Z', cancelledAt: '2026-01-03T00:00:00Z' }),
      ),
    ).toBe('cancelled');
  });
});
