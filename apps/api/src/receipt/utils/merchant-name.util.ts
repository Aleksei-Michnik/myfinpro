/**
 * Phase 7, iteration 7.8 — merchant-name normalization (design §2.3).
 *
 * The global registry dedup key: lowercased, whitespace-collapsed,
 * diacritics-stripped (NFD + combining-mark removal keeps Hebrew/Arabic
 * base letters intact while folding é→e, ü→u). Kept pure and dependency-
 * free — the same rule must hold wherever merchants are matched or created.
 */
export function normalizeMerchantName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
