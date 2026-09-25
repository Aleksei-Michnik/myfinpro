import { describe, expect, it } from 'vitest';
import { isConfident, paramsForFilter, visibleFor } from './AccountReviewQueue';
import type { StatementLine } from '@/lib/account/types';

function line(over: Partial<StatementLine>): StatementLine {
  return {
    id: 'l',
    accountId: 'a',
    importId: 'i',
    postedAt: '2026-09-20',
    direction: 'OUT',
    amountCents: 1000,
    currency: 'ILS',
    description: 'x',
    normalizedDescription: 'x',
    status: 'PENDING',
    createdAt: '2026-09-25T00:00:00.000Z',
    ...over,
  };
}
const tx = { id: 't1' } as StatementLine['transaction'];

describe('paramsForFilter', () => {
  it('asks the server for pending lines, needs_input for the input filter, everything for decided', () => {
    expect(paramsForFilter('all')).toMatchObject({ status: 'PENDING' });
    expect(paramsForFilter('needsInput')).toMatchObject({
      status: 'PENDING',
      suggestion: 'needs_input',
    });
    expect(paramsForFilter('suggested')).toMatchObject({ status: 'PENDING' });
    expect(paramsForFilter('decided').status).toBeUndefined();
    expect(paramsForFilter('all', 'imp').importId).toBe('imp');
  });
});

describe('isConfident', () => {
  it('trusts a match with a transaction, a transfer with an account, a create with a category', () => {
    expect(
      isConfident(
        line({ suggestion: { action: 'match', score: 0.9, transaction: tx, candidates: [] } }),
      ),
    ).toBe(true);
    expect(
      isConfident(
        line({ suggestion: { action: 'match', score: 0.9, transaction: null, candidates: [] } }),
      ),
    ).toBe(false);
    expect(
      isConfident(
        line({
          suggestion: { action: 'transfer', score: 1, transferAccountId: 'b', candidates: [] },
        }),
      ),
    ).toBe(true);
    expect(
      isConfident(
        line({ suggestion: { action: 'create', score: 0.5, categoryId: 'c', candidates: [] } }),
      ),
    ).toBe(true);
    expect(
      isConfident(
        line({ suggestion: { action: 'create', score: 0.5, categoryId: null, candidates: [] } }),
      ),
    ).toBe(false);
    expect(isConfident(line({ suggestion: { action: 'none', score: 0, candidates: [] } }))).toBe(
      false,
    );
    expect(isConfident(line({ suggestion: null }))).toBe(false);
  });
});

describe('visibleFor', () => {
  const rows = [
    line({
      id: 'p1',
      suggestion: { action: 'match', score: 0.9, transaction: tx, candidates: [] },
    }),
    line({ id: 'p2', suggestion: null }),
    line({ id: 'd1', status: 'MATCHED' }),
  ];
  it('splits pending from decided and keeps only confident rows under suggested', () => {
    expect(visibleFor('all', rows).map((l) => l.id)).toEqual(['p1', 'p2']);
    expect(visibleFor('suggested', rows).map((l) => l.id)).toEqual(['p1']);
    expect(visibleFor('decided', rows).map((l) => l.id)).toEqual(['d1']);
  });
});
