/**
 * Phase 8, iteration 8.3 — dependency-free trigram (Dice) similarity for
 * the fuzzy matching stage (design §1.2). MySQL has no pg_trgm, so the
 * candidate pool is prefiltered with indexed lookups and scored here.
 *
 * Strings are padded with two leading and one trailing sentinel space
 * (the pg_trgm convention) so short names still produce useful trigrams
 * and word starts weigh more than word middles.
 */

function trigramsOf(value: string): Set<string> {
  const grams = new Set<string>();
  for (const word of value.split(' ')) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      grams.add(padded.slice(i, i + 3));
    }
  }
  return grams;
}

/**
 * Dice coefficient over trigram sets: 2·|A∩B| / (|A|+|B|), in [0, 1].
 * Inputs are expected to be pre-normalized with `normalizeLookupName`.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  // Iterate the smaller set — O(min) lookups against the larger.
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const gram of small) {
    if (large.has(gram)) shared++;
  }
  return (2 * shared) / (ta.size + tb.size);
}

/**
 * Tokens worth prefiltering the fuzzy pool with: longest first, ≥ 3 chars,
 * capped so one receipt line never fans out into many LIKE scans.
 */
export function fuzzyLookupTokens(normalized: string, maxTokens = 2): string[] {
  return [...new Set(normalized.split(' '))]
    .filter((token) => token.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, maxTokens);
}
