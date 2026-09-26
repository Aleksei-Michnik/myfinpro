import { purchaseRowsCte } from '../../analytics/engine/purchase-rows.sql';
import {
  COUNTABLE_TRANSACTION_STATUS,
  COUNTABLE_TRANSACTION_TYPE,
  COUNTABLE_TRANSACTION_WHERE,
} from './countable';

describe('countable transaction rule', () => {
  it('is POSTED + ONE_TIME as a Prisma where fragment', () => {
    expect(COUNTABLE_TRANSACTION_WHERE).toEqual({ status: 'POSTED', type: 'ONE_TIME' });
  });

  // The ledger balance (Prisma) and analytics (raw SQL) must apply the same
  // rule. This is the guard against the two drifting apart.
  it('is the same rule the analytics base CTE applies in SQL', () => {
    const { sql } = purchaseRowsCte({ userId: 'u1', direction: 'OUT' });
    expect(sql).toContain(`t.status = '${COUNTABLE_TRANSACTION_STATUS}'`);
    expect(sql).toContain(`t.type = '${COUNTABLE_TRANSACTION_TYPE}'`);
  });

  it('analytics additionally drops transfers, which move money but are not spending', () => {
    const { sql } = purchaseRowsCte({ userId: 'u1', direction: 'OUT' });
    expect(sql).toContain('t.transfer_account_id IS NULL');
  });
});
