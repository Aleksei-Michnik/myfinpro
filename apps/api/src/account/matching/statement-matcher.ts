// Phase 20 · Iteration 20.4 — the matcher's arithmetic, pure (design §5).
//
// Everything here is a function of its arguments: no Prisma, no Nest, no
// clock. The candidate pool and the DB writes live in
// `statement-matching.service.ts`; scores, thresholds, the tie rule and the
// transfer detection live here, where they can be unit-tested exhaustively.

import {
  INSTITUTION_META,
  STATEMENT_MATCH_CONFIDENT_SCORE,
  STATEMENT_MATCH_DATE_WINDOW_DAYS,
  type AccountInstitution,
  type StatementSuggestedAction,
} from '@myfinpro/shared';
import { trigramSimilarity } from '../../product/utils/trigram.util';

/** Weights of the score (design §5.2) — they sum to 1.00 without the bonus. */
export const SCORE_WEIGHTS = {
  /** The exact-amount gate is what a candidate is admitted on at all. */
  amount: 0.6,
  /** Falls off linearly to 0 at the edge of the date window. */
  date: 0.25,
  /** Best trigram similarity over the candidate's texts. */
  description: 0.15,
  /** Bonus: the transaction already sits on this account. */
  sameAccount: 0.1,
} as const;

/** How far the best score must lead the runner-up to be applied (design §5.2). */
export const STATEMENT_MATCH_LEAD = 0.1;

/** Candidates kept on a stored suggestion (design §6.2). */
export const MAX_SUGGESTION_CANDIDATES = 5;

/**
 * Slack for the binary-float arithmetic of the weighted score: a lead that
 * IS the margin must not miss it because 0.95 − 0.10 lands on
 * 0.8500000000000001. Far below any score difference that carries meaning.
 */
const EPSILON = 1e-9;

/** The line as the matcher sees it. */
export interface MatchableLine {
  id: string;
  direction: string;
  amountCents: number;
  currency: string;
  normalizedDescription: string;
  /** `valueAt ?? postedAt` — the date the window is measured around. */
  at: Date;
}

/** A transaction as the matcher sees it. */
export interface MatchableCandidate {
  id: string;
  direction: string;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  accountId: string | null;
  transferAccountId: string | null;
  /**
   * Texts to compare the description against: the note, the linked receipt's
   * merchant `normalizedName` and the primary category name (design §5.2).
   * Expected pre-normalized (`normalizeDescription` / `normalizeLookupName`).
   */
  texts: string[];
}

export interface ScoredCandidate {
  transactionId: string;
  score: number;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two instants, rounded — the window is day-grained. */
export function dayDistance(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY);
}

/**
 * Do the line and the transaction describe the same movement? The hard gates
 * of design §5.1 minus the date: same currency, same amount to the cent, same
 * direction, and placed on this account or on none. A transfer row qualifies
 * only for an `IN` line on the card it pays — the one case §5.3 carves out.
 */
export function matchesLineShape(
  line: Pick<MatchableLine, 'direction' | 'amountCents' | 'currency'>,
  candidate: Pick<
    MatchableCandidate,
    'direction' | 'amountCents' | 'currency' | 'accountId' | 'transferAccountId'
  >,
  accountId: string,
): boolean {
  if (candidate.currency !== line.currency) return false;
  if (candidate.amountCents !== line.amountCents) return false;
  if (candidate.accountId !== null && candidate.accountId !== accountId) {
    // The transfer carve-out: the row leaves another account and lands here.
    return candidate.transferAccountId === accountId && line.direction === 'IN';
  }
  if (candidate.transferAccountId !== null) return false;
  return candidate.direction === line.direction;
}

/**
 * The full admissibility test: the shape AND the date window. A decision the
 * user makes by hand only has to satisfy the shape — they can see a delay the
 * window does not allow for.
 */
export function isAdmissible(
  line: MatchableLine,
  candidate: MatchableCandidate,
  accountId: string,
  windowDays: number = STATEMENT_MATCH_DATE_WINDOW_DAYS,
): boolean {
  if (!matchesLineShape(line, candidate, accountId)) return false;
  return dayDistance(line.at, candidate.occurredAt) <= windowDays;
}

/**
 * `0.60 + 0.25·(1 − |Δdays| / window) + 0.15·max(sim) + 0.10 if same account`
 * — design §5.2, verbatim.
 */
export function scoreCandidate(
  line: MatchableLine,
  candidate: MatchableCandidate,
  accountId: string,
  windowDays: number = STATEMENT_MATCH_DATE_WINDOW_DAYS,
): number {
  const days = Math.min(dayDistance(line.at, candidate.occurredAt), windowDays);
  const proximity = windowDays === 0 ? 1 : 1 - days / windowDays;

  let similarity = 0;
  for (const text of candidate.texts) {
    if (!text) continue;
    similarity = Math.max(similarity, trigramSimilarity(line.normalizedDescription, text));
  }

  return (
    SCORE_WEIGHTS.amount +
    SCORE_WEIGHTS.date * proximity +
    SCORE_WEIGHTS.description * similarity +
    (candidate.accountId === accountId ? SCORE_WEIGHTS.sameAccount : 0)
  );
}

/** Admissible candidates, scored, best first, capped at the stored top 5. */
export function rankCandidates(
  line: MatchableLine,
  candidates: MatchableCandidate[],
  accountId: string,
  windowDays: number = STATEMENT_MATCH_DATE_WINDOW_DAYS,
): ScoredCandidate[] {
  return candidates
    .filter((candidate) => isAdmissible(line, candidate, accountId, windowDays))
    .map((candidate) => ({
      transactionId: candidate.id,
      score: scoreCandidate(line, candidate, accountId, windowDays),
    }))
    .sort((a, b) => b.score - a.score || a.transactionId.localeCompare(b.transactionId))
    .slice(0, MAX_SUGGESTION_CANDIDATES);
}

/**
 * Is the best candidate confident enough to be applied without asking?
 * Design §5.2: at or above the threshold AND leading the runner-up by the
 * lead margin. A tie — two equally plausible transactions — is never
 * resolved by the machine.
 */
export function isConfidentMatch(
  ranked: ScoredCandidate[],
  threshold: number = STATEMENT_MATCH_CONFIDENT_SCORE,
): boolean {
  const best = ranked[0];
  if (!best || best.score < threshold - EPSILON) return false;
  const runnerUp = ranked[1];
  return !runnerUp || best.score - runnerUp.score >= STATEMENT_MATCH_LEAD - EPSILON;
}

/** A card account the actor can see, as the transfer proposal needs it. */
export interface VisibleCard {
  id: string;
  institution: string | null;
  billingAccountId: string | null;
}

/**
 * Card-bill detection (design §5.3): an `OUT` line on a `BANK` account whose
 * description contains an issuer's bill token proposes a transfer to that
 * issuer's card — preferring a card that names this very account as its
 * billing account, falling back to any visible card of the issuer.
 * Returns the destination account id, or `null` when nothing fits.
 */
export function detectCardBillTransfer(
  line: MatchableLine,
  accountKind: string,
  accountId: string,
  cards: VisibleCard[],
): string | null {
  if (accountKind !== 'BANK' || line.direction !== 'OUT') return null;

  for (const [institution, meta] of Object.entries(INSTITUTION_META) as [
    AccountInstitution,
    (typeof INSTITUTION_META)[AccountInstitution],
  ][]) {
    const tokens = meta.billTokens;
    if (!tokens?.length) continue;
    const hit = tokens.some((token) =>
      line.normalizedDescription.includes(token.trim().toLowerCase()),
    );
    if (!hit) continue;

    const ofIssuer = cards.filter((card) => card.institution === institution);
    const billed = ofIssuer.find((card) => card.billingAccountId === accountId);
    const chosen = billed ?? ofIssuer[0];
    if (chosen) return chosen.id;
  }
  return null;
}

/** An equal-and-opposite line on another of the user's accounts (design §5.3). */
export interface CounterLine {
  accountId: string;
  direction: string;
  amountCents: number;
  currency: string;
  at: Date;
}

/**
 * The other half of a transfer already imported on a second account: same
 * amount and currency, opposite direction, inside the window. The proposal's
 * destination is the account the money landed on.
 */
export function detectCounterpartTransfer(
  line: MatchableLine,
  counterLines: CounterLine[],
  accountId: string,
  windowDays: number = STATEMENT_MATCH_DATE_WINDOW_DAYS,
): string | null {
  const opposite = line.direction === 'OUT' ? 'IN' : 'OUT';
  const hit = counterLines.find(
    (counter) =>
      counter.accountId !== accountId &&
      counter.direction === opposite &&
      counter.amountCents === line.amountCents &&
      counter.currency === line.currency &&
      dayDistance(line.at, counter.at) <= windowDays,
  );
  // Either way the answer is "the other account": the destination of an OUT
  // line, the source of an IN one.
  return hit?.accountId ?? null;
}

/** The stored suggestion snapshot (design §4.2 / §6.2). */
export interface SuggestionSnapshot {
  action: StatementSuggestedAction;
  score: number;
  transactionId?: string;
  categoryId?: string;
  transferAccountId?: string;
  candidates: ScoredCandidate[];
  /**
   * Derived from (`action`, `categoryId`) at write time so the review filter
   * `suggestion=needs_input` is one indexed JSON comparison instead of a
   * predicate the database cannot express: `none`, or a `create` with no
   * remembered category (design §6.2).
   */
  needsInput: boolean;
}

/**
 * Turn the evidence about one line into the snapshot that is stored on it.
 * Precedence is design §5.2 → §5.3 → §5.4: a confident match wins, then a
 * transfer proposal, then create (with a remembered category when there is
 * one), then `none` with the candidates listed for the reviewer.
 */
export function buildSuggestion(input: {
  ranked: ScoredCandidate[];
  transferAccountId?: string | null;
  categoryId?: string | null;
  confidentScore?: number;
}): SuggestionSnapshot {
  const ranked = input.ranked;
  const best = ranked[0];

  if (isConfidentMatch(ranked, input.confidentScore)) {
    return {
      action: 'match',
      score: best.score,
      transactionId: best.transactionId,
      candidates: ranked,
      needsInput: false,
    };
  }

  if (input.transferAccountId) {
    return {
      action: 'transfer',
      // A transfer proposal is acted on by "apply all", so it carries the
      // confidence threshold itself rather than a candidate's score.
      score: input.confidentScore ?? STATEMENT_MATCH_CONFIDENT_SCORE,
      transferAccountId: input.transferAccountId,
      candidates: ranked,
      needsInput: false,
    };
  }

  if (ranked.length > 0) {
    // Look-alikes exist but none is decisive: proposing `create` here would
    // invite a duplicate, so the reviewer picks (design §5.2 — the candidates
    // are listed and nothing is applied).
    return {
      action: 'none',
      score: best.score,
      candidates: ranked,
      needsInput: true,
    };
  }

  const action: StatementSuggestedAction = 'create';
  const categoryId = input.categoryId ?? undefined;
  return {
    action,
    score: 0,
    ...(categoryId ? { categoryId } : {}),
    candidates: [],
    needsInput: categoryId === undefined,
  };
}
