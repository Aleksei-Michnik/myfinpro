// Phase 20 · Iteration 20.4 — the dedup fence (design §4.2).
//
// Israeli exports carry no row identifier that survives a re-export at every
// institution (research notes §3), so a re-imported overlapping statement is
// deduplicated by a fingerprint computed from the row itself, fenced by
// `@@unique(accountId, fingerprint)`.
//
// The fingerprint deliberately hashes only the facts every export of the same
// row agrees on — account, posting date, direction, amount and the normalized
// description — plus the row's ordinal among the identical tuples of its
// import. A reference number or a running balance is NOT part of it: the same
// movement exported twice (a different date range, a CSV instead of an XLSX,
// the connector instead of a file) often carries one in one variant and not in
// the other, and hashing it would let the same row in twice. The ordinal
// reproduces on a re-import of the same rows, which is what keeps the whole
// thing idempotent while still separating two identical coffees on one day
// (design §11 records the residual case: a bank that reorders identical rows
// between exports).

import { createHash } from 'crypto';

export interface FingerprintInput {
  /** ISO yyyy-mm-dd — the posting date, day precision. */
  postedAt: string;
  direction: string;
  amountCents: number;
  normalizedDescription: string;
}

/**
 * Fingerprint one line. `ordinal` is its 0-based position among the lines of
 * the same import sharing the same (date, direction, amount, description)
 * tuple.
 */
export function statementLineFingerprint(
  accountId: string,
  line: FingerprintInput,
  ordinal: number,
): string {
  const payload = [
    accountId,
    line.postedAt,
    line.direction,
    String(line.amountCents),
    line.normalizedDescription,
    String(ordinal),
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
