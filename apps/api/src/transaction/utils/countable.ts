// Phase 20 · Iteration 20.2 — the "countable transaction" rule, in one place.
//
// A transaction counts as real money exactly when it is `POSTED` and
// `ONE_TIME`: recurring / plan parents are templates, and `PENDING` / `DUE`
// occurrences have not moved money yet. Analytics has expressed this rule in
// SQL since Phase 9 (`analytics/engine/purchase-rows.sql.ts`, the `base` CTE:
// `WHERE t.status = 'POSTED' AND t.type = 'ONE_TIME'`); ledger balances
// (design §2.2) need the same rule as a Prisma filter. The two must never
// drift — change one, change the other, and say so in the progress doc.

import type { Prisma } from '@prisma/client';

/** Status a transaction must have to move money. */
export const COUNTABLE_TRANSACTION_STATUS = 'POSTED';
/** Type a transaction must have to move money (parents are templates). */
export const COUNTABLE_TRANSACTION_TYPE = 'ONE_TIME';

/**
 * Prisma `where` fragment for countable transactions — spread into a larger
 * filter, never used alone:
 *
 * ```ts
 * where: { ...COUNTABLE_TRANSACTION_WHERE, accountId: { in: ids } }
 * ```
 */
export const COUNTABLE_TRANSACTION_WHERE = {
  status: COUNTABLE_TRANSACTION_STATUS,
  type: COUNTABLE_TRANSACTION_TYPE,
} as const satisfies Prisma.TransactionWhereInput;
