import { Prisma } from '@prisma/client';

/**
 * Scope filter entry, membership-verified by the caller before SQL is built
 * (AnalyticsEngineService.assertScopesAccessible).
 */
export interface VerifiedScope {
  scope: 'personal' | 'group';
  groupId?: string;
}

/**
 * Predicate over a `transaction_attributions` row aliased `a` — the SQL twin
 * of `TransactionService.buildVisibilityWhere` (design §2.3).
 *
 * Without `scopes`: full visibility — the caller's personal attributions OR
 * attributions to any group they belong to. With `scopes`: restricted to the
 * listed scopes only (group membership already verified, so a bare
 * `group_id = ?` comparison is safe).
 *
 * Used both inside the base `EXISTS` (count-once mode) and as the join
 * condition in attribution-join mode — one source of truth.
 */
export function attributionScopePredicate(userId: string, scopes?: VerifiedScope[]): Prisma.Sql {
  if (!scopes || scopes.length === 0) {
    return Prisma.sql`(
      (a.scope_type = 'personal' AND a.user_id = ${userId})
      OR (a.scope_type = 'group' AND a.group_id IN (
        SELECT gm.group_id FROM group_memberships gm WHERE gm.user_id = ${userId}
      ))
    )`;
  }

  const alternatives = scopes.map((s) =>
    s.scope === 'personal'
      ? Prisma.sql`(a.scope_type = 'personal' AND a.user_id = ${userId})`
      : Prisma.sql`(a.scope_type = 'group' AND a.group_id = ${s.groupId})`,
  );
  return Prisma.sql`(${Prisma.join(alternatives, ' OR ')})`;
}
