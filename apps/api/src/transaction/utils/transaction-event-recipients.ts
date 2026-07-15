// Phase 6 · Iteration 6.18.1.4.1 — multicast recipient computation for the
// realtime EventBus. A transaction is visible to a user iff at least one of
// its attributions is personal to them OR targets a group they are a
// member of (mirrors `TransactionService.buildVisibilityWhere`). The creator
// is always included so that mutations they made — even on transactions that
// no longer have any attribution targeting them (defensive) — are echoed
// back to them.

import type { PrismaService } from '../../prisma/prisma.service';

/** Minimal attribution shape needed to compute recipients. */
export interface RecipientAttribution {
  scopeType: string;
  userId: string | null;
  groupId: string | null;
}

/**
 * Compute the set of user ids that should receive a realtime event for a
 * transaction with the given attributions. The creator is always included.
 *
 * One DB read at most (group memberships); inputs can be the union of
 * pre- and post-change attributions, so callers don't need to call this
 * twice when emitting attribution lifecycle events.
 */
export async function computeTransactionRecipients(
  prisma: PrismaService,
  attributions: readonly RecipientAttribution[],
  creatorId: string,
): Promise<string[]> {
  const userIds = new Set<string>();
  userIds.add(creatorId);

  const groupIds = new Set<string>();
  for (const a of attributions) {
    if (a.scopeType === 'personal' && a.userId) {
      userIds.add(a.userId);
    } else if (a.scopeType === 'group' && a.groupId) {
      groupIds.add(a.groupId);
    }
  }

  if (groupIds.size > 0) {
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId: { in: Array.from(groupIds) } },
      select: { userId: true },
    });
    for (const m of memberships) {
      userIds.add(m.userId);
    }
  }

  return Array.from(userIds);
}
