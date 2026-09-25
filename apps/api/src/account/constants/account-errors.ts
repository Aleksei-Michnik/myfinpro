/**
 * Account-domain error codes — Phase 20 design §6.
 *
 * Same shape as `budget-errors.ts` / `transaction-errors.ts`: a frozen map
 * whose values ride in the `errorCode` field of HTTP error payloads
 * (`common/filters/http-exception.filter.ts` copies them onto the body).
 *
 * Iteration 20.2 added the CRUD codes, 20.4 the import / statement-line ones
 * — the same "extend the union per iteration" pattern transaction-errors.ts
 * uses.
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
 *
 * Iteration 20.4 — statement imports and the review queue (design §6.2):
 *
 * - ACCOUNT_CURRENCY_MISMATCH  — an import line is denominated in a currency
 *                                the account does not hold. Lines always move
 *                                the account's own currency; only the
 *                                `originalCurrency` pair may differ.
 * - ACCOUNT_IMPORT_TOO_LARGE   — more than ACCOUNT_IMPORT_MAX_LINES lines in
 *                                one request; the browser chunks longer
 *                                statements into consecutive imports.
 * - ACCOUNT_IMPORT_INVALID_LINE — a line passed DTO validation but is
 *                                semantically impossible (a date outside the
 *                                plausible range, installment 7 of 6). The
 *                                message names the line's INDEX only —
 *                                statement content is never echoed (§9).
 * - STATEMENT_LINE_NOT_FOUND   — no such line on this account (404; a line is
 *                                only ever reached through its account).
 * - STATEMENT_LINE_NOT_PENDING — the line was already decided; undo it with
 *                                DELETE …/link before deciding again.
 * - STATEMENT_LINE_ALREADY_LINKED — the target transaction is already
 *                                confirmed by another statement line (the
 *                                link is 1:1).
 * - STATEMENT_MATCH_INVALID    — the target transaction does not agree with
 *                                the line (amount, currency or direction), so
 *                                it cannot be what the bank recorded.
 */
export const ACCOUNT_ERRORS = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_FORBIDDEN: 'ACCOUNT_FORBIDDEN',
  ACCOUNT_ARCHIVED: 'ACCOUNT_ARCHIVED',
  ACCOUNT_INVALID_SCOPE: 'ACCOUNT_INVALID_SCOPE',
  ACCOUNT_INVALID_BILLING: 'ACCOUNT_INVALID_BILLING',
  ACCOUNT_INVALID_INSTITUTION: 'ACCOUNT_INVALID_INSTITUTION',
  ACCOUNT_CURRENCY_MISMATCH: 'ACCOUNT_CURRENCY_MISMATCH',
  ACCOUNT_IMPORT_TOO_LARGE: 'ACCOUNT_IMPORT_TOO_LARGE',
  ACCOUNT_IMPORT_INVALID_LINE: 'ACCOUNT_IMPORT_INVALID_LINE',
  STATEMENT_LINE_NOT_FOUND: 'STATEMENT_LINE_NOT_FOUND',
  STATEMENT_LINE_NOT_PENDING: 'STATEMENT_LINE_NOT_PENDING',
  STATEMENT_LINE_ALREADY_LINKED: 'STATEMENT_LINE_ALREADY_LINKED',
  STATEMENT_MATCH_INVALID: 'STATEMENT_MATCH_INVALID',
} as const;

export type AccountErrorCode = (typeof ACCOUNT_ERRORS)[keyof typeof ACCOUNT_ERRORS];
