// Phase 20 · Iteration 20.2 — the account visibility predicate, in one place.
//
// An account is visible to a user iff it is their own personal account or it
// belongs to a group they are a member of (design §2.1 — the budgets matrix).
// Mutations need more than this (owner / group admin); reads, statement
// imports and line decisions need exactly this.
//
// Shared by `AccountService` (list / load) and `TransactionService` (the
// `accountId` / `transferAccountId` guards), so a transaction can never be
// placed on an account its creator cannot see.

import type { Prisma } from '@prisma/client';

export function buildAccountVisibilityWhere(userId: string): Prisma.AccountWhereInput {
  return {
    OR: [
      { scopeType: 'personal', ownerId: userId },
      { scopeType: 'group', group: { memberships: { some: { userId } } } },
    ],
  };
}
