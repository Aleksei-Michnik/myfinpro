import { describe, expect, it } from 'vitest';
import { defaultFilters, paymentMatchesFilters, type FilterablePayment } from '../filters';

const make = (over: Partial<FilterablePayment> = {}): FilterablePayment => ({
  direction: 'OUT',
  category: { id: 'cat-1' },
  occurredAt: '2026-04-25T00:00:00Z',
  starredByMe: false,
  note: null,
  parentPaymentId: null,
  attributions: [{ scope: 'personal', userId: 'u1' }],
  ...over,
});

describe('paymentMatchesFilters', () => {
  it('default filters match every payment', () => {
    expect(paymentMatchesFilters(make(), defaultFilters())).toBe(true);
  });

  it('scope=personal filters out group-only payments', () => {
    const f = defaultFilters('personal');
    expect(
      paymentMatchesFilters(make({ attributions: [{ scope: 'personal', userId: 'u1' }] }), f),
    ).toBe(true);
    expect(
      paymentMatchesFilters(make({ attributions: [{ scope: 'group', groupId: 'g1' }] }), f),
    ).toBe(false);
  });

  it('scope=group:<id> matches only that group', () => {
    const f = defaultFilters('group:g1');
    expect(
      paymentMatchesFilters(make({ attributions: [{ scope: 'group', groupId: 'g1' }] }), f),
    ).toBe(true);
    expect(
      paymentMatchesFilters(make({ attributions: [{ scope: 'group', groupId: 'g2' }] }), f),
    ).toBe(false);
  });

  it('direction filter narrows by direction', () => {
    const f = { ...defaultFilters(), direction: 'IN' as const };
    expect(paymentMatchesFilters(make({ direction: 'IN' }), f)).toBe(true);
    expect(paymentMatchesFilters(make({ direction: 'OUT' }), f)).toBe(false);
  });

  it('starred filter only allows starred payments', () => {
    const f = { ...defaultFilters(), starred: true };
    expect(paymentMatchesFilters(make({ starredByMe: true }), f)).toBe(true);
    expect(paymentMatchesFilters(make({ starredByMe: false }), f)).toBe(false);
  });

  it('childScope=parents filters out occurrences', () => {
    const f = { ...defaultFilters(), childScope: 'parents' as const };
    expect(paymentMatchesFilters(make({ parentPaymentId: null }), f)).toBe(true);
    expect(paymentMatchesFilters(make({ parentPaymentId: 'p1' }), f)).toBe(false);
  });

  it('search matches against the note', () => {
    const f = { ...defaultFilters(), search: 'lunch' };
    expect(paymentMatchesFilters(make({ note: 'tasty Lunch out' }), f)).toBe(true);
    expect(paymentMatchesFilters(make({ note: 'breakfast' }), f)).toBe(false);
    expect(paymentMatchesFilters(make({ note: null }), f)).toBe(false);
  });

  it('from / to bound the occurredAt range (half-open)', () => {
    const f = { ...defaultFilters(), from: '2026-04-01', to: '2026-05-01' };
    expect(paymentMatchesFilters(make({ occurredAt: '2026-04-25T00:00:00Z' }), f)).toBe(true);
    expect(paymentMatchesFilters(make({ occurredAt: '2026-05-01T00:00:00Z' }), f)).toBe(false);
    expect(paymentMatchesFilters(make({ occurredAt: '2026-03-31T00:00:00Z' }), f)).toBe(false);
  });
});
