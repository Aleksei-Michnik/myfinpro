// Phase 20: Accounts, Balances & Bank Sync — shared enums, tuning constants and
// the normalised statement-line shape. Consumed by apps/api (DTO validation,
// ledger balances, the 20.4 matcher), apps/web (forms, the import wizard,
// the browser-side statement parser) and, later, apps/connector.
// See docs/phase-20-accounts-design.md §4.1.
//
// Institution metadata lives in ../constants/institutions.ts (display names,
// the kinds an institution issues, and its bill-description tokens).

/** What an account physically is. `OTHER` holds a balance and nothing more. */
export const ACCOUNT_KINDS = ['BANK', 'CARD', 'CASH', 'OTHER'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/**
 * Where a batch of statement lines came from. Institution values mark a
 * recognised export preset; `generic_csv` is the column-mapped fallback,
 * `manual` a hand-entered batch, `connector` the user-run scraper (20.7).
 */
export const ACCOUNT_IMPORT_SOURCES = [
  'hapoalim',
  'leumi',
  'discount',
  'mizrahi',
  'isracard',
  'cal',
  'max',
  'amex',
  'generic_csv',
  'manual',
  'connector',
] as const;
export type AccountImportSource = (typeof ACCOUNT_IMPORT_SOURCES)[number];

/**
 * Lifecycle of one statement line (design §2.5): imported → decided.
 * `MATCHED`/`CREATED` carry a `transactionId`; `PENDING`/`IGNORED` do not.
 */
export const STATEMENT_LINE_STATUSES = ['PENDING', 'MATCHED', 'CREATED', 'IGNORED'] as const;
export type StatementLineStatus = (typeof STATEMENT_LINE_STATUSES)[number];

/** What the matcher proposes for a pending line (design §5.2–§5.4). */
export const STATEMENT_SUGGESTED_ACTIONS = ['match', 'transfer', 'create', 'none'] as const;
export type StatementSuggestedAction = (typeof STATEMENT_SUGGESTED_ACTIONS)[number];

/** Hard cap on the number of lines one import request may carry. */
export const ACCOUNT_IMPORT_MAX_LINES = 2000;

/** ± days around a line's date in which a transaction may still match it. */
export const STATEMENT_MATCH_DATE_WINDOW_DAYS = 5;

/** Score at or above which a suggestion is applied without asking (design §5.2). */
export const STATEMENT_MATCH_CONFIDENT_SCORE = 0.8;

/**
 * Masked account/card identifier — 2 to 4 digits. A full account or card
 * number must never be entered, stored or transmitted (design §9).
 */
export const ACCOUNT_LAST4_PATTERN = /^\d{2,4}$/;

/**
 * One normalised statement row, as produced by the browser-side parser or by
 * the connector, and accepted by `POST /accounts/:id/imports` (20.4).
 * Amounts are integer minor units (cents) and always positive — the sign is
 * carried by `direction`.
 */
export interface ImportLineInput {
  /** ISO date (yyyy-mm-dd) — the bank's posting date. */
  postedAt: string;
  /** ISO date — purchase date on card statements, when it differs. */
  valueAt?: string;
  /** Positive integer minor units, in the account's currency. */
  amountCents: number;
  direction: 'IN' | 'OUT';
  /** ISO-4217; defaults to the account currency. */
  currency: string;
  /** Raw description, as printed (≤ 300 chars). */
  description: string;
  /** Second free-text column when present (≤ 300). */
  memo?: string;
  /** Reference number when the export has one (≤ 64). */
  externalId?: string;
  /** Running-balance column, when the export has one. */
  balanceAfterCents?: number;
  /** Card statements: the amount in the purchase currency. */
  originalAmountCents?: number;
  originalCurrency?: string;
  /** "תשלום 2 מתוך 6" → 2. */
  installmentNumber?: number;
  /** "תשלום 2 מתוך 6" → 6. */
  installmentTotal?: number;
  /** The issuer's own sector column, if any (≤ 100). */
  categoryHint?: string;
}
