// Phase 20 · Iteration 20.4 — the dedup fence (design §4.2).
//
// Israeli exports carry no row identifier that survives a re-export at every
// institution (research notes §3), so a re-imported overlapping statement is
// deduplicated by a fingerprint computed from the row itself, fenced by
// `@@unique(accountId, fingerprint)`.
//
// The tie-breaker is what makes two genuinely different rows that look
// identical (two identical coffees on the same day) survive: the export's own
// reference number when it has one, else the running balance after the row,
// else the row's ordinal among the identical rows of THIS import. The ordinal
// reproduces on a re-import of the same file, which is what keeps the whole
// thing idempotent (design §11 records the one case that can still slip: a
// bank that reorders identical rows between exports).

import { createHash } from 'crypto';

export interface FingerprintInput {
  /** ISO yyyy-mm-dd — the posting date, day precision. */
  postedAt: string;
  direction: string;
  amountCents: number;
  normalizedDescription: string;
  externalId?: string | null;
  balanceAfterCents?: number | null;
}

/**
 * Fingerprint one line. `ordinal` is its 0-based position among the lines of
 * the same import sharing the same (date, direction, amount, description)
 * tuple — only consulted when the row carries neither a reference nor a
 * running balance.
 */
export function statementLineFingerprint(
  accountId: string,
  line: FingerprintInput,
  ordinal: number,
): string {
  const tiebreak =
    line.externalId ??
    (line.balanceAfterCents !== null && line.balanceAfterCents !== undefined
      ? String(line.balanceAfterCents)
      : String(ordinal));

  const payload = [
    accountId,
    line.postedAt,
    line.direction,
    String(line.amountCents),
    line.normalizedDescription,
    tiebreak,
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Fingerprint a whole import in order, assigning each line its ordinal among
 * the identical tuples seen so far in this batch.
 */
export function fingerprintImportLines(
  accountId: string,
  lines: FingerprintInput[],
): { fingerprint: string; ordinal: number }[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = [line.postedAt, line.direction, line.amountCents, line.normalizedDescription].join(
      '|',
    );
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return { fingerprint: statementLineFingerprint(accountId, line, ordinal), ordinal };
  });
}
