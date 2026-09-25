// Phase 20 · 20.5 — drain the confident suggestions of an account. The API
// applies a bounded batch per call and reports what is left; this loop keeps
// calling while it makes progress, and stops on the first round that applies
// nothing or leaves `remaining` where it was, so a server quirk can never turn
// a tab into a request storm (security review 2026-09-25, finding 1).

import type { ApplySuggestionsResult } from './types';

/** Rounds beyond which the loop gives up regardless — far above any real queue. */
export const APPLY_SUGGESTIONS_MAX_ROUNDS = 50;

export interface DrainTotals {
  matched: number;
  created: number;
  transferred: number;
  skipped: number;
}

export async function drainSuggestions(
  applyOnce: () => Promise<ApplySuggestionsResult>,
): Promise<DrainTotals> {
  const totals: DrainTotals = { matched: 0, created: 0, transferred: 0, skipped: 0 };
  let lastRemaining = Number.POSITIVE_INFINITY;
  for (let round = 0; round < APPLY_SUGGESTIONS_MAX_ROUNDS; round += 1) {
    const r = await applyOnce();
    totals.matched += r.matched;
    totals.created += r.created;
    totals.transferred += r.transferred;
    totals.skipped += r.skipped;
    const applied = r.matched + r.created + r.transferred;
    if (r.remaining === 0 || applied === 0 || r.remaining >= lastRemaining) break;
    lastRemaining = r.remaining;
  }
  return totals;
}
