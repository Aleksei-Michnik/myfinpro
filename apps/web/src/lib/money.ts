// Money-input helpers shared by every dialog that edits an amount
// (transactions, budgets). Extracted from TransactionFormDialog in
// Phase 10 · Iteration 10.3 so the budget form reuses the exact same
// parsing rules instead of re-implementing them.

/**
 * Parse a user-typed decimal amount string into integer cents.
 * Accepts up to two decimal places; returns `null` for anything that
 * isn't a plain decimal number (empty, letters, >2 decimals).
 */
export function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const val = Number(trimmed);
  if (Number.isNaN(val)) return null;
  return Math.round(val * 100);
}
