/**
 * Account-domain error codes — Phase 20 design §6.
 *
 * Same shape as `budget-errors.ts` / `transaction-errors.ts`: a frozen map
 * whose values ride in the `errorCode` field of HTTP error payloads
 * (`common/filters/http-exception.filter.ts` copies them onto the body).
 *
 * Only the codes the iteration-20.2 CRUD surface can emit live here. The
 * import / statement-line codes design §6 also lists
 * (`ACCOUNT_CURRENCY_MISMATCH`, `ACCOUNT_IMPORT_TOO_LARGE`,
 * `ACCOUNT_IMPORT_INVALID_LINE`, `STATEMENT_LINE_*`, `STATEMENT_MATCH_INVALID`)
 * are added by iteration 20.4 together with the endpoints that raise them —
 * the same "extend the union per iteration" pattern transaction-errors.ts uses.
 *
 * - ACCOUNT_NOT_FOUND          — missing id OR the caller has no read access
 *                                (404; existence is never leaked to outsiders).
 * - ACCOUNT_FORBIDDEN          — a group member (non-admin) attempting a
 *                                mutation, or asking for a group scope they
 *                                are not in. The one place we 403, because
 *                                the account IS deliberately visible to them.
 * - ACCOUNT_ARCHIVED           — mutation attempted on an archived account
 *                                (unarchive and delete remain possible).
 * - ACCOUNT_INVALID_SCOPE      — malformed scope combos (personal + groupId,
 *                                group without groupId), a group the caller
 *                                cannot see, or an attempt to change the
 *                                immutable scope / currency of an account.
 * - ACCOUNT_INVALID_BILLING    — `billingAccountId` is not a visible, active
 *                                BANK account in the same scope and currency,
 *                                the card would bill itself, `billingDay` is
 *                                given without an account, or billing fields
 *                                are set on a non-CARD account.
 * - ACCOUNT_INVALID_INSTITUTION — the institution does not issue accounts of
 *                                this `kind` (`INSTITUTION_META[x].kinds`).
 */
export const ACCOUNT_ERRORS = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_FORBIDDEN: 'ACCOUNT_FORBIDDEN',
  ACCOUNT_ARCHIVED: 'ACCOUNT_ARCHIVED',
  ACCOUNT_INVALID_SCOPE: 'ACCOUNT_INVALID_SCOPE',
  ACCOUNT_INVALID_BILLING: 'ACCOUNT_INVALID_BILLING',
  ACCOUNT_INVALID_INSTITUTION: 'ACCOUNT_INVALID_INSTITUTION',
} as const;

export type AccountErrorCode = (typeof ACCOUNT_ERRORS)[keyof typeof ACCOUNT_ERRORS];
