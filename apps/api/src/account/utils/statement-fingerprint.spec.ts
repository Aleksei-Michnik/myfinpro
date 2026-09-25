import { fingerprintImportLines, statementLineFingerprint } from './statement-fingerprint';

/**
 * Phase 20 · Iteration 20.4 — the dedup fence (design §4.2 / §11).
 *
 * What must hold: the same file re-imported produces the same fingerprints
 * (so nothing is duplicated), and two genuinely different rows that look
 * identical produce different ones (so nothing is lost).
 */
describe('statementLineFingerprint', () => {
  const ACCOUNT = 'account-a';
  const line = (over: Partial<Parameters<typeof statementLineFingerprint>[1]> = {}) => ({
    postedAt: '2026-09-03',
    direction: 'OUT',
    amountCents: 1250,
    normalizedDescription: 'קפה ליד הבית',
    ...over,
  });

  it('is a stable sha256 hex digest', () => {
    const fingerprint = statementLineFingerprint(ACCOUNT, line(), 0);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(statementLineFingerprint(ACCOUNT, line(), 0)).toBe(fingerprint);
  });

  it('separates accounts, dates, directions, amounts and descriptions', () => {
    const base = statementLineFingerprint(ACCOUNT, line(), 0);
    expect(statementLineFingerprint('account-b', line(), 0)).not.toBe(base);
    expect(statementLineFingerprint(ACCOUNT, line({ postedAt: '2026-09-04' }), 0)).not.toBe(base);
    expect(statementLineFingerprint(ACCOUNT, line({ direction: 'IN' }), 0)).not.toBe(base);
    expect(statementLineFingerprint(ACCOUNT, line({ amountCents: 1251 }), 0)).not.toBe(base);
    expect(
      statementLineFingerprint(ACCOUNT, line({ normalizedDescription: 'קפה אחר' }), 0),
    ).not.toBe(base);
  });

  it('prefers the reference, then the running balance, then the ordinal', () => {
    const withReference = statementLineFingerprint(ACCOUNT, line({ externalId: 'A1' }), 0);
    // The ordinal is ignored once the export carries its own identifier.
    expect(statementLineFingerprint(ACCOUNT, line({ externalId: 'A1' }), 7)).toBe(withReference);

    const withBalance = statementLineFingerprint(ACCOUNT, line({ balanceAfterCents: 5000 }), 0);
    expect(statementLineFingerprint(ACCOUNT, line({ balanceAfterCents: 5000 }), 7)).toBe(
      withBalance,
    );
    expect(withBalance).not.toBe(withReference);
  });
});

describe('fingerprintImportLines', () => {
  const ACCOUNT = 'account-a';
  const coffee = {
    postedAt: '2026-09-03',
    direction: 'OUT',
    amountCents: 1250,
    normalizedDescription: 'קפה ליד הבית',
  };

  it('gives two identical rows of one import different fingerprints', () => {
    const [first, second] = fingerprintImportLines(ACCOUNT, [coffee, coffee]);
    expect(first.ordinal).toBe(0);
    expect(second.ordinal).toBe(1);
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it('reproduces them exactly on a re-import of the same file', () => {
    const first = fingerprintImportLines(ACCOUNT, [
      coffee,
      coffee,
      { ...coffee, amountCents: 900 },
    ]);
    const again = fingerprintImportLines(ACCOUNT, [
      coffee,
      coffee,
      { ...coffee, amountCents: 900 },
    ]);
    expect(again.map((row) => row.fingerprint)).toEqual(first.map((row) => row.fingerprint));
  });

  it('counts ordinals per identical tuple, not per import', () => {
    const rows = fingerprintImportLines(ACCOUNT, [
      coffee,
      { ...coffee, normalizedDescription: 'מאפיה' },
      coffee,
    ]);
    expect(rows.map((row) => row.ordinal)).toEqual([0, 0, 1]);
  });
});
