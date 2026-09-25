// Phase 6 — the category visibility clauses, in one place.
//
// A category is usable by a user when it is a system category, their own, or
// owned by a group they belong to. `Category.ownerId` is a bare column (no
// relation is declared for it, because it points at a user OR a group), so
// the group ids have to be fetched first — hence the two arguments.
//
// Lifted out of `CategoryService.list` in 20.4: the statement matcher's
// category memory may only propose a category the reviewer can actually use
// (security review L2), and a second copy of the predicate would be exactly
// the kind of drift that leaks one.

import type { Prisma } from '@prisma/client';

export function categoryVisibilityClauses(
  userId: string,
  memberGroupIds: string[],
): Prisma.CategoryWhereInput[] {
  const clauses: Prisma.CategoryWhereInput[] = [
    { ownerType: 'system' },
    { ownerType: 'user', ownerId: userId },
  ];
  if (memberGroupIds.length > 0) {
    clauses.push({ ownerType: 'group', ownerId: { in: memberGroupIds } });
  }
  return clauses;
}
