import { fuzzyLookupTokens, trigramSimilarity } from './trigram.util';

describe('trigramSimilarity', () => {
  it('is 1 for identical strings and 0 for empty input', () => {
    expect(trigramSimilarity('milk 3%', 'milk 3%')).toBe(1);
    expect(trigramSimilarity('', 'milk')).toBe(0);
    expect(trigramSimilarity('milk', '')).toBe(0);
  });

  it('scores close spellings high and unrelated strings low', () => {
    const close = trigramSimilarity('milk 3% 1l', 'milk 3% 1.5l');
    const far = trigramSimilarity('milk 3% 1l', 'chicken breast');
    expect(close).toBeGreaterThan(0.6);
    expect(far).toBeLessThan(0.15);
    expect(close).toBeGreaterThan(far);
  });

  it('is symmetric', () => {
    expect(trigramSimilarity('tomatoes', 'tomato')).toBeCloseTo(
      trigramSimilarity('tomato', 'tomatoes'),
      10,
    );
  });

  it('works on Hebrew names', () => {
    expect(trigramSimilarity('חלב 3% תנובה', 'חלב 3%')).toBeGreaterThan(0.5);
  });
});

describe('fuzzyLookupTokens', () => {
  it('returns the longest tokens (≥3 chars), capped', () => {
    expect(fuzzyLookupTokens('organic whole milk 1l')).toEqual(['organic', 'whole']);
  });

  it('drops short tokens and dedupes', () => {
    expect(fuzzyLookupTokens('ok ok milk')).toEqual(['milk']);
    expect(fuzzyLookupTokens('a b c')).toEqual([]);
  });
});
