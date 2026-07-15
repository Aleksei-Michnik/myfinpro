// Phase 6 · Iteration 6.15 — small UTC-based month range helper used by the
// aggregated dashboard. Pure function so it can be unit-tested without
// timezone surprises.

export interface MonthRange {
  fromIso: string;
  toIso: string;
}

/**
 * Compute the [first-of-this-month, first-of-next-month) UTC range covering
 * the given `now` (defaults to the current wall clock). Returns ISO strings
 * suitable for `from`/`to` query params on the transactions list endpoint.
 */
export function computeMonthRange(now: Date = new Date()): MonthRange {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { fromIso: start.toISOString(), toIso: next.toISOString() };
}
