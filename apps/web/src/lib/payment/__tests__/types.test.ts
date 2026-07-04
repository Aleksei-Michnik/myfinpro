// Phase 6 · Iteration 6.18.1 — truth-table coverage for the
// `deriveScheduleStatus` helper. The ordering rule (`cancelledAt` wins
// over `pausedAt`) is exercised explicitly so a regression flips the
// badge colour pill.

import { describe, expect, it } from 'vitest';
import {
  canEditPayment,
  cannotEditReason,
  deriveScheduleStatus,
  type ScheduleResponse,
} from '../types';

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

// Phase 6 · Iteration 6.18.1.2 — edit-eligibility helper consumed by
// `<PaymentDetailHeader>` and `<PaymentRow>` (DRY).
describe('canEditPayment / cannotEditReason', () => {
  it('ONE_TIME parent (no parentPaymentId) is editable', () => {
    expect(canEditPayment({ parentPaymentId: null, type: 'ONE_TIME' })).toBe(true);
    expect(cannotEditReason({ parentPaymentId: null, type: 'ONE_TIME' })).toBeNull();
  });

  it('RECURRING parent is editable (6.18.1 added schedule sub-form support)', () => {
    expect(canEditPayment({ parentPaymentId: null, type: 'RECURRING' })).toBe(true);
    expect(cannotEditReason({ parentPaymentId: null, type: 'RECURRING' })).toBeNull();
  });

  it('child occurrence (parentPaymentId set) is non-editable → generatedOccurrence', () => {
    expect(canEditPayment({ parentPaymentId: 'p-parent', type: 'ONE_TIME' })).toBe(false);
    expect(cannotEditReason({ parentPaymentId: 'p-parent', type: 'ONE_TIME' })).toBe(
      'generatedOccurrence',
    );
  });

  it('child occurrence wins over unsupported type when both apply', () => {
    expect(cannotEditReason({ parentPaymentId: 'p-parent', type: 'INSTALLMENT' })).toBe(
      'generatedOccurrence',
    );
  });

  it('still-unsupported types map to unsupportedType', () => {
    for (const type of ['INSTALLMENT', 'LOAN', 'MORTGAGE', 'LIMITED_PERIOD'] as const) {
      expect(canEditPayment({ parentPaymentId: null, type })).toBe(false);
      expect(cannotEditReason({ parentPaymentId: null, type })).toBe('unsupportedType');
    }
  });
});
