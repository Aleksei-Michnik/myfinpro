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
