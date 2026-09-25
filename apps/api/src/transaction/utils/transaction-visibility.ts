// Phase 6 · design §5.2 — the transaction visibility predicate, in one place.
//
// A transaction is visible to a user iff at least one of its attributions is
// personal to them OR targets a group they are a member of. Lifted out of
// `TransactionService` in 20.4 so the statement matcher can build its
// candidate pool with the SAME predicate instead of a copy — a group member
// must never be offered a match against a personal transaction they cannot
// see (design §9).

import type { Prisma } from '@prisma/client';

export function buildTransactionVisibilityWhere(userId: string): Prisma.TransactionWhereInput {
  return {
    attributions: {
      some: {
        OR: [
          { scopeType: 'personal', userId },
          { scopeType: 'group', group: { memberships: { some: { userId } } } },
        ],
      },
    },
  };
}
