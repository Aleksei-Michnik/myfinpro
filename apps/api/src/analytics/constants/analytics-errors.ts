/**
 * Analytics-domain error codes — Phase 9 design §5.
 *
 * Mirrors the budget/transaction error-constant structure: a frozen map whose
 * values ride in the `errorCode` field of HTTP error payloads.
 *
 * - ANALYTICS_INVALID_QUERY  — semantic query errors the DTO cannot catch:
 *                              granularity without a period dimension (or the
 *                              reverse), dateFrom ≥ dateTo, malformed scope
 *                              entries, offset past the group cap.
 * - ANALYTICS_SCOPE_FORBIDDEN — a scope filter names a group the caller is
 *                              not a member of (403, mirrors transaction
 *                              list scope narrowing).
 * - ANALYTICS_INVALID_CURSOR — cursor undecodable OR its query fingerprint
 *                              does not match the submitted query (a cursor
 *                              is only valid for the exact query it came
 *                              from).
 */
export const ANALYTICS_ERRORS = {
  ANALYTICS_INVALID_QUERY: 'ANALYTICS_INVALID_QUERY',
  ANALYTICS_SCOPE_FORBIDDEN: 'ANALYTICS_SCOPE_FORBIDDEN',
  ANALYTICS_INVALID_CURSOR: 'ANALYTICS_INVALID_CURSOR',
} as const;

export type AnalyticsErrorCode = (typeof ANALYTICS_ERRORS)[keyof typeof ANALYTICS_ERRORS];
