/**
 * Budget-domain error codes — Phase 10 design §5 "Error codes".
 *
 * Mirrors the payment/auth error-constant structure: a frozen map whose
 * values ride in the `errorCode` field of HTTP error payloads.
 *
 * - BUDGET_NOT_FOUND      — missing id OR caller has no read access (404,
 *                           existence is never leaked to outsiders).
 * - BUDGET_INVALID_SCOPE  — malformed scope combos (personal + groupId,
 *                           group without groupId) or a group the caller
 *                           cannot see.
 * - BUDGET_INVALID_PERIOD — CUSTOM without startsAt < endsAt, or a
 *                           repeating period carrying explicit bounds.
 * - BUDGET_INVALID_CATEGORY — category missing, not visible in the
 *                           budget's scope, or direction not OUT/BOTH.
 * - BUDGET_ARCHIVED       — mutation attempted on an archived budget
 *                           (unarchive and delete remain possible).
 * - BUDGET_FORBIDDEN      — group member (non-admin) attempting a mutation;
 *                           the one place we 403 because the resource is
 *                           deliberately visible to members (design §2.3).
 */
export const BUDGET_ERRORS = {
  BUDGET_NOT_FOUND: 'BUDGET_NOT_FOUND',
  BUDGET_INVALID_SCOPE: 'BUDGET_INVALID_SCOPE',
  BUDGET_INVALID_PERIOD: 'BUDGET_INVALID_PERIOD',
  BUDGET_INVALID_CATEGORY: 'BUDGET_INVALID_CATEGORY',
  BUDGET_ARCHIVED: 'BUDGET_ARCHIVED',
  BUDGET_FORBIDDEN: 'BUDGET_FORBIDDEN',
} as const;

export type BudgetErrorCode = (typeof BUDGET_ERRORS)[keyof typeof BUDGET_ERRORS];
