import {
  STATEMENT_MATCH_CONFIDENT_SCORE,
  STATEMENT_MATCH_DATE_WINDOW_DAYS,
} from '@myfinpro/shared';
import {
  buildSuggestion,
  dayDistance,
  detectCardBillTransfer,
  detectCounterpartTransfer,
  isAdmissible,
  isConfidentMatch,
  matchesLineShape,
  MAX_SUGGESTION_CANDIDATES,
  rankCandidates,
  scoreCandidate,
  SCORE_WEIGHTS,
  STATEMENT_MATCH_LEAD,
  type MatchableCandidate,
  type MatchableLine,
} from './statement-matcher';

/**
 * Phase 20 · Iteration 20.4 — the matcher's arithmetic (design §5).
 *
 * Pure functions, so every rule is tested directly: the hard gates, the
 * weighted score, the confidence + lead rule, the card-bill and
 * equal-and-opposite transfer detections, and the precedence the stored
 * snapshot encodes.
 */
describe('statement matcher', () => {
  const ACCOUNT = 'account-a';
  const OTHER_ACCOUNT = 'account-b';

  const line = (over: Partial<MatchableLine> = {}): MatchableLine => ({
    id: 'line-1',
    direction: 'OUT',
    amountCents: 12500,
    currency: 'ILS',
    normalizedDescription: 'סופר פארם',
    at: new Date('2026-09-10T00:00:00Z'),
    ...over,
  });

  const candidate = (over: Partial<MatchableCandidate> = {}): MatchableCandidate => ({
    id: 'tx-1',
    direction: 'OUT',
    amountCents: 12500,
    currency: 'ILS',
    occurredAt: new Date('2026-09-10T00:00:00Z'),
    accountId: null,
    transferAccountId: null,
    texts: [],
    ...over,
  });

  describe('hard gates', () => {
    it('requires the same currency, amount and direction', () => {
      expect(matchesLineShape(line(), candidate(), ACCOUNT)).toBe(true);
      expect(matchesLineShape(line(), candidate({ currency: 'USD' }), ACCOUNT)).toBe(false);
      expect(matchesLineShape(line(), candidate({ amountCents: 12499 }), ACCOUNT)).toBe(false);
      expect(matchesLineShape(line(), candidate({ direction: 'IN' }), ACCOUNT)).toBe(false);
    });

    it('accepts a transaction on this account or on none, never on another', () => {
      expect(matchesLineShape(line(), candidate({ accountId: ACCOUNT }), ACCOUNT)).toBe(true);
      expect(matchesLineShape(line(), candidate({ accountId: OTHER_ACCOUNT }), ACCOUNT)).toBe(
        false,
      );
    });

    it('accepts a transfer row only as the IN line of the account it pays', () => {
      const bill = candidate({
        accountId: OTHER_ACCOUNT,
        transferAccountId: ACCOUNT,
        direction: 'OUT',
      });
      expect(matchesLineShape(line({ direction: 'IN' }), bill, ACCOUNT)).toBe(true);
      expect(matchesLineShape(line({ direction: 'OUT' }), bill, ACCOUNT)).toBe(false);
      // A transfer that has nothing to do with this account is never a candidate.
      expect(
        matchesLineShape(
          line({ direction: 'IN' }),
          candidate({ accountId: null, transferAccountId: OTHER_ACCOUNT, direction: 'OUT' }),
          ACCOUNT,
        ),
      ).toBe(false);
    });

    it('rejects a transaction outside the date window', () => {
      const inside = candidate({ occurredAt: new Date('2026-09-14T00:00:00Z') });
      const outside = candidate({ occurredAt: new Date('2026-09-16T00:00:00Z') });
      expect(dayDistance(line().at, outside.occurredAt)).toBeGreaterThan(
        STATEMENT_MATCH_DATE_WINDOW_DAYS,
      );
      expect(isAdmissible(line(), inside, ACCOUNT)).toBe(true);
      expect(isAdmissible(line(), outside, ACCOUNT)).toBe(false);
    });
  });

  describe('score', () => {
    it('is amount + full date proximity for a same-day, unplaced, unnamed row', () => {
      expect(scoreCandidate(line(), candidate(), ACCOUNT)).toBeCloseTo(
        SCORE_WEIGHTS.amount + SCORE_WEIGHTS.date,
        5,
      );
    });

    it('decays linearly with the day distance', () => {
      const twoDaysOff = candidate({ occurredAt: new Date('2026-09-12T00:00:00Z') });
      expect(scoreCandidate(line(), twoDaysOff, ACCOUNT)).toBeCloseTo(
        SCORE_WEIGHTS.amount + SCORE_WEIGHTS.date * (1 - 2 / STATEMENT_MATCH_DATE_WINDOW_DAYS),
        5,
      );
    });

    it('adds the description similarity and the same-account bonus', () => {
      const named = candidate({ texts: ['סופר פארם'], accountId: ACCOUNT });
      expect(scoreCandidate(line(), named, ACCOUNT)).toBeCloseTo(
        SCORE_WEIGHTS.amount +
          SCORE_WEIGHTS.date +
          SCORE_WEIGHTS.description +
          SCORE_WEIGHTS.sameAccount,
        5,
      );
    });

    it('takes the best of note, receipt merchant and category name', () => {
      const withMerchant = candidate({ texts: ['', 'סופר פארם', 'בריאות'] });
      expect(scoreCandidate(line(), withMerchant, ACCOUNT)).toBeCloseTo(
        SCORE_WEIGHTS.amount + SCORE_WEIGHTS.date + SCORE_WEIGHTS.description,
        5,
      );
    });
  });

  describe('ranking and confidence', () => {
    it('sorts best first and keeps at most five candidates', () => {
      const candidates = Array.from({ length: 7 }, (_, i) =>
        candidate({ id: `tx-${i}`, occurredAt: new Date(`2026-09-${10 + (i % 5)}T00:00:00Z`) }),
      );
      const ranked = rankCandidates(line(), candidates, ACCOUNT);
      expect(ranked).toHaveLength(MAX_SUGGESTION_CANDIDATES);
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    });

    it('is confident only above the threshold and ahead by the lead', () => {
      expect(isConfidentMatch([{ transactionId: 'a', score: 0.95 }])).toBe(true);
      expect(
        isConfidentMatch([
          { transactionId: 'a', score: 0.95 },
          { transactionId: 'b', score: 0.95 - STATEMENT_MATCH_LEAD },
        ]),
      ).toBe(true);
      // A tie between two plausible rows is never resolved by the machine.
      expect(
        isConfidentMatch([
          { transactionId: 'a', score: 0.95 },
          { transactionId: 'b', score: 0.9 },
        ]),
      ).toBe(false);
      expect(
        isConfidentMatch([{ transactionId: 'a', score: STATEMENT_MATCH_CONFIDENT_SCORE - 0.01 }]),
      ).toBe(false);
      expect(isConfidentMatch([])).toBe(false);
    });
  });

  describe('transfer detection', () => {
    const bill = line({ direction: 'OUT', normalizedDescription: 'ישראכרט חיוב חודשי' });

    it('proposes the card billed by this very bank account', () => {
      const cards = [
        { id: 'card-other', institution: 'isracard', billingAccountId: 'account-z' },
        { id: 'card-mine', institution: 'isracard', billingAccountId: ACCOUNT },
      ];
      expect(detectCardBillTransfer(bill, 'BANK', ACCOUNT, cards)).toBe('card-mine');
    });

    it('falls back to any visible card of the issuer', () => {
      const cards = [{ id: 'card-other', institution: 'isracard', billingAccountId: null }];
      expect(detectCardBillTransfer(bill, 'BANK', ACCOUNT, cards)).toBe('card-other');
    });

    it('never proposes one on a non-bank account, an IN line or an unknown issuer', () => {
      const cards = [{ id: 'card-mine', institution: 'isracard', billingAccountId: ACCOUNT }];
      expect(detectCardBillTransfer(bill, 'CARD', ACCOUNT, cards)).toBeNull();
      expect(
        detectCardBillTransfer({ ...bill, direction: 'IN' }, 'BANK', ACCOUNT, cards),
      ).toBeNull();
      expect(
        detectCardBillTransfer(
          line({ normalizedDescription: 'קפה ליד הבית' }),
          'BANK',
          ACCOUNT,
          cards,
        ),
      ).toBeNull();
    });

    it('proposes the account carrying an equal-and-opposite line in the window', () => {
      const counter = {
        accountId: OTHER_ACCOUNT,
        direction: 'IN',
        amountCents: 12500,
        currency: 'ILS',
        at: new Date('2026-09-12T00:00:00Z'),
      };
      expect(detectCounterpartTransfer(line(), [counter], ACCOUNT)).toBe(OTHER_ACCOUNT);
      // Same direction, another currency, or too far away: no proposal.
      expect(
        detectCounterpartTransfer(line(), [{ ...counter, direction: 'OUT' }], ACCOUNT),
      ).toBeNull();
      expect(
        detectCounterpartTransfer(line(), [{ ...counter, currency: 'USD' }], ACCOUNT),
      ).toBeNull();
      expect(
        detectCounterpartTransfer(
          line(),
          [{ ...counter, at: new Date('2026-09-30T00:00:00Z') }],
          ACCOUNT,
        ),
      ).toBeNull();
      // A line on the same account is not the other half of anything.
      expect(
        detectCounterpartTransfer(line(), [{ ...counter, accountId: ACCOUNT }], ACCOUNT),
      ).toBeNull();
    });
  });

  describe('buildSuggestion precedence', () => {
    it('prefers a confident match over everything else', () => {
      const suggestion = buildSuggestion({
        ranked: [{ transactionId: 'tx-1', score: 0.95 }],
        transferAccountId: 'card-1',
        categoryId: 'cat-1',
      });
      expect(suggestion).toMatchObject({
        action: 'match',
        transactionId: 'tx-1',
        needsInput: false,
      });
    });

    it('proposes a transfer when no match is confident', () => {
      const suggestion = buildSuggestion({ ranked: [], transferAccountId: 'card-1' });
      expect(suggestion).toMatchObject({
        action: 'transfer',
        transferAccountId: 'card-1',
        score: STATEMENT_MATCH_CONFIDENT_SCORE,
        needsInput: false,
      });
    });

    it('asks the reviewer when look-alikes exist but none leads', () => {
      const suggestion = buildSuggestion({
        ranked: [
          { transactionId: 'tx-1', score: 0.9 },
          { transactionId: 'tx-2', score: 0.87 },
        ],
        categoryId: 'cat-1',
      });
      expect(suggestion.action).toBe('none');
      expect(suggestion.needsInput).toBe(true);
      expect(suggestion.candidates).toHaveLength(2);
    });

    it('creates with a remembered category, and needs input without one', () => {
      expect(buildSuggestion({ ranked: [], categoryId: 'cat-1' })).toMatchObject({
        action: 'create',
        categoryId: 'cat-1',
        needsInput: false,
      });
      const blind = buildSuggestion({ ranked: [] });
      expect(blind).toMatchObject({ action: 'create', needsInput: true, candidates: [] });
      expect(blind.categoryId).toBeUndefined();
    });
  });
});
