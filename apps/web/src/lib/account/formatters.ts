// Phase 20 · Iteration 20.3 — pure formatting helpers for accounts. Reuses
// the transaction formatters (`formatAmount`, `formatScopeLabel`) rather
// than re-deriving currency/scope rendering (design §0 "Money" / "Labels").

import type { AccountSummary } from './types';

/**
 * Design §2.4 — a CARD account's ledger balance is "what is owed this
 * cycle": negative means money is owed, and the UI must never render that
 * as a negative debt figure. `true` when the balance should render as an
 * absolute "owed" amount instead of a signed balance.
 */
export function isCardOwed(account: Pick<AccountSummary, 'kind' | 'ledgerBalanceCents'>): boolean {
  return account.kind === 'CARD' && account.ledgerBalanceCents < 0;
}

/** The amount to render for the ledger `<Stat>` — always non-negative when `isCardOwed`. */
export function displayLedgerCents(
  account: Pick<AccountSummary, 'kind' | 'ledgerBalanceCents'>,
): number {
  return isCardOwed(account) ? Math.abs(account.ledgerBalanceCents) : account.ledgerBalanceCents;
}

/** `reconciliationGapCents` is `null` (no reported balance) or an integer; 0 = reconciled. */
export function isReconciled(gapCents: number | null | undefined): boolean {
  return gapCents !== null && gapCents !== undefined && gapCents === 0;
}
