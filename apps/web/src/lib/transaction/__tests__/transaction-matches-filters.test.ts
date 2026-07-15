import { describe, expect, it } from 'vitest';
import { defaultFilters, transactionMatchesFilters, type FilterableTransaction } from '../filters';

const make = (over: Partial<FilterableTransaction> = {}): FilterableTransaction => ({
  direction: 'OUT',
  category: { id: 'cat-1' },
  occurredAt: '2026-04-25T00:00:00Z',
  starredByMe: false,
  note: null,
  parentTransactionId: null,
  attributions: [{ scope: 'personal', userId: 'u1' }],
  ...over,
});

describe('transactionMatchesFilters', () => {
  it('default filters match every transaction', () => {
    expect(transactionMatchesFilters(make(), defaultFilters())).toBe(true);
  });

  it('scope=personal filters out group-only transactions', () => {
    const f = defaultFilters('personal');
    expect(
      transactionMatchesFilters(make({ attributions: [{ scope: 'personal', userId: 'u1' }] }), f),
    ).toBe(true);
    expect(
      transactionMatchesFilters(make({ attributions: [{ scope: 'group', groupId: 'g1' }] }), f),
    ).toBe(false);
  });

  it('scope=group:<id> matches only that group', () => {
    const f = defaultFilters('group:g1');
    expect(
      transactionMatchesFilters(make({ attributions: [{ scope: 'group', groupId: 'g1' }] }), f),
    ).toBe(true);
    expect(
      transactionMatchesFilters(make({ attributions: [{ scope: 'group', groupId: 'g2' }] }), f),
    ).toBe(false);
  });

  it('direction filter narrows by direction', () => {
    const f = { ...defaultFilters(), direction: 'IN' as const };
    expect(transactionMatchesFilters(make({ direction: 'IN' }), f)).toBe(true);
    expect(transactionMatchesFilters(make({ direction: 'OUT' }), f)).toBe(false);
  });

  it('starred filter only allows starred transactions', () => {
    const f = { ...defaultFilters(), starred: true };
    expect(transactionMatchesFilters(make({ starredByMe: true }), f)).toBe(true);
    expect(transactionMatchesFilters(make({ starredByMe: false }), f)).toBe(false);
  });

  it('childScope=parents filters out occurrences', () => {
    const f = { ...defaultFilters(), childScope: 'parents' as const };
    expect(transactionMatchesFilters(make({ parentTransactionId: null }), f)).toBe(true);
    expect(transactionMatchesFilters(make({ parentTransactionId: 'p1' }), f)).toBe(false);
  });

  it('search matches against the note', () => {
    const f = { ...defaultFilters(), search: 'lunch' };
    expect(transactionMatchesFilters(make({ note: 'tasty Lunch out' }), f)).toBe(true);
    expect(transactionMatchesFilters(make({ note: 'breakfast' }), f)).toBe(false);
    expect(transactionMatchesFilters(make({ note: null }), f)).toBe(false);
  });

  it('from / to bound the occurredAt range (half-open)', () => {
    const f = { ...defaultFilters(), from: '2026-04-01', to: '2026-05-01' };
    expect(transactionMatchesFilters(make({ occurredAt: '2026-04-25T00:00:00Z' }), f)).toBe(true);
    expect(transactionMatchesFilters(make({ occurredAt: '2026-05-01T00:00:00Z' }), f)).toBe(false);
    expect(transactionMatchesFilters(make({ occurredAt: '2026-03-31T00:00:00Z' }), f)).toBe(false);
  });
});
