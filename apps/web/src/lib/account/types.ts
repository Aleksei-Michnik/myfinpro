// Phase 20 · Iteration 20.3 — frontend wire types for the Account API
// (apps/api/src/account). Re-exports the shared enums/constants so the web
// app consumes a single source of truth (packages/shared) and declares the
// DTO-shaped interfaces returned by the NestJS controllers shipped in 20.2.

export {
  ACCOUNT_KINDS,
  ACCOUNT_INSTITUTIONS,
  ACCOUNT_LAST4_PATTERN,
  INSTITUTION_META,
  TRANSFER_CATEGORY_SLUG,
} from '@myfinpro/shared';

export type { AccountKind, AccountInstitution, InstitutionMeta } from '@myfinpro/shared';

/** Shape returned by every /accounts endpoint (AccountResponseDto). */
export interface AccountSummary {
  id: string;
  name: string;
  kind: 'BANK' | 'CARD' | 'CASH' | 'OTHER';
  institution?: string | null;
  /** ISO 4217 three-letter code. Immutable after creation. */
  currency: string;
  /** Masked identifier, 2–4 digits. Never a full account or card number. */
  last4?: string | null;
  color?: string | null;
  scopeType: 'personal' | 'group';
  ownerId?: string | null;
  groupId?: string | null;
  /** Balance anchor amount in minor units. */
  openingBalanceCents: number;
  /** ISO 8601 date of the balance anchor. */
  openingBalanceAt: string;
  /** The bank's own figure — never derived. */
  reportedBalanceCents?: number | null;
  reportedBalanceAt?: string | null;
  /** CARD only — the BANK account debited on the billing day. */
  billingAccountId?: string | null;
  billingDay?: number | null;
  archivedAt?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  /** Derived, never stored (design §2.2). */
  ledgerBalanceCents: number;
  ledgerBalanceAt: string;
  /** Statement lines still awaiting a decision. */
  pendingLinesCount: number;
  /** reportedBalanceCents − ledger as of reportedBalanceAt; null with no reported figure. */
  reconciliationGapCents?: number | null;
}

export interface AccountListResponse {
  data: AccountSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** POST /accounts body (CreateAccountDto). */
export interface CreateAccountInput {
  name: string;
  kind: 'BANK' | 'CARD' | 'CASH' | 'OTHER';
  institution?: string | null;
  /** Defaults to the owner's / group's defaultCurrency when omitted. Immutable afterwards. */
  currency?: string;
  last4?: string | null;
  color?: string | null;
  scopeType: 'personal' | 'group';
  /** Required when scopeType=group; forbidden otherwise. */
  groupId?: string;
  openingBalanceCents?: number;
  openingBalanceAt?: string;
  reportedBalanceCents?: number | null;
  reportedBalanceAt?: string | null;
  billingAccountId?: string | null;
  billingDay?: number | null;
}

/**
 * PATCH /accounts/:id body (UpdateAccountDto). `scopeType`, `groupId` and
 * `currency` are immutable — recreate the account to move it.
 */
export interface UpdateAccountInput {
  name?: string;
  institution?: string | null;
  last4?: string | null;
  color?: string | null;
  openingBalanceCents?: number;
  openingBalanceAt?: string;
  reportedBalanceCents?: number | null;
  reportedBalanceAt?: string | null;
  billingAccountId?: string | null;
  billingDay?: number | null;
}

export interface ListAccountsParams {
  /** `'all'`, `'personal'`, or `'group:<groupId>'`. Default 'all'. */
  scope?: string;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}

// ── Phase 20 · 20.5 — statement imports and the review queue ────────────────

export type {
  AccountImportSource,
  ImportLineInput,
  StatementLineStatus,
  StatementSuggestedAction,
} from '@myfinpro/shared';
export {
  ACCOUNT_IMPORT_MAX_LINES,
  ACCOUNT_IMPORT_SOURCES,
  STATEMENT_LINE_STATUSES,
  STATEMENT_SUGGESTED_ACTIONS,
} from '@myfinpro/shared';

import type { StatementLineStatus, StatementSuggestedAction } from '@myfinpro/shared';
import type { TransactionSummary } from '@/lib/transaction/types';

/** One of the matcher's ranked alternatives (StatementCandidateDto). */
export interface StatementCandidate {
  transaction: TransactionSummary;
  /** 0–1. */
  score: number;
}

/** What the matcher proposed at import time (StatementSuggestionDto). */
export interface StatementSuggestion {
  action: StatementSuggestedAction;
  score: number;
  /** Set when `action = match`. */
  transaction?: TransactionSummary | null;
  /** Remembered category for `create`; null when the user must pick one. */
  categoryId?: string | null;
  category?: TransactionSummary['categories'][number] | null;
  /** The own account on the other side when `action = transfer`. */
  transferAccountId?: string | null;
  /** Up to five alternatives, best first. */
  candidates: StatementCandidate[];
}

/** A bank line as the API returns it (StatementLineResponseDto). */
export interface StatementLine {
  id: string;
  accountId: string;
  importId: string;
  postedAt: string;
  valueAt?: string | null;
  direction: 'IN' | 'OUT';
  amountCents: number;
  currency: string;
  description: string;
  normalizedDescription: string;
  memo?: string | null;
  externalId?: string | null;
  balanceAfterCents?: number | null;
  originalAmountCents?: number | null;
  originalCurrency?: string | null;
  installmentNumber?: number | null;
  installmentTotal?: number | null;
  categoryHint?: string | null;
  status: StatementLineStatus;
  transactionId?: string | null;
  transaction?: TransactionSummary | null;
  suggestion?: StatementSuggestion | null;
  decidedAt?: string | null;
  decidedById?: string | null;
  createdAt: string;
}

export interface StatementLineListResponse {
  data: StatementLine[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** A decision's answer: the line as it now is, plus the transaction it touched. */
export interface StatementLineDecision {
  line: StatementLine;
  transaction?: TransactionSummary | null;
}

/** `suggestion=` filter of GET /accounts/:id/lines. */
export type StatementSuggestionFilter = StatementSuggestedAction | 'needs_input';

export interface ListLinesParams {
  status?: StatementLineStatus;
  importId?: string;
  suggestion?: StatementSuggestionFilter;
  limit?: number;
  cursor?: string;
}

/** POST /accounts/:id/imports body (CreateImportDto). Lines are already parsed in the browser. */
export interface CreateImportInput {
  source: string;
  originalName?: string;
  lines: import('@myfinpro/shared').ImportLineInput[];
  statementBalanceCents?: number;
  statementBalanceAt?: string;
  periodFrom?: string;
  periodTo?: string;
}

/** One import and its counters (AccountImportResponseDto). */
export interface AccountImport {
  id: string;
  accountId: string;
  importedById: string;
  source: string;
  originalName?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  statementBalanceCents?: number | null;
  statementBalanceAt?: string | null;
  totalCount: number;
  insertedCount: number;
  duplicateCount: number;
  /** Still-pending lines per proposal kind. */
  suggestedMatchCount: number;
  suggestedTransferCount: number;
  suggestedCreateCount: number;
  needsInputCount: number;
  createdAt: string;
}

export interface AccountImportListResponse {
  data: AccountImport[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateFromLineInput {
  categoryIds: string[];
  note?: string;
  attributions?: import('@/lib/transaction/types').AttributionScope[];
}

export interface ApplySuggestionsResult {
  matched: number;
  transferred: number;
  created: number;
  skipped: number;
  /** Pending lines the batch cap left for another call; 0 when drained. */
  remaining: number;
}
