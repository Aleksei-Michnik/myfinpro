// Phase 8: Product Catalog, Matching & Barcode — shared enums, the staged-
// matching candidate contract, the registry lookup-key normalization, and
// GTIN validation. Used by apps/api (registry, matcher, extraction worker)
// and apps/web (walkthrough, catalog, barcode form validation).
// See docs/phase-8-products-design.md.

/** Walkthrough lifecycle of a receipt item's product link (design §1.3). */
export const PRODUCT_MATCH_STATUSES = ['PENDING', 'AUTO', 'CONFIRMED', 'SKIPPED'] as const;
export type ProductMatchStatus = (typeof PRODUCT_MATCH_STATUSES)[number];

/** Which matcher stage produced a candidate (design §1.2). */
export const PRODUCT_MATCH_STAGES = ['barcode', 'alias', 'exact', 'fuzzy', 'llm'] as const;
export type ProductMatchStage = (typeof PRODUCT_MATCH_STAGES)[number];

/** Provenance of a product alias row. */
export const PRODUCT_ALIAS_SOURCES = ['confirmation', 'manual', 'extraction', 'off'] as const;
export type ProductAliasSource = (typeof PRODUCT_ALIAS_SOURCES)[number];

/**
 * One staged-matcher proposal, stored on `receipt_items.match_candidates`
 * and rendered by the walkthrough with a confidence meter.
 */
export interface ProductMatchCandidate {
  productId: string;
  /** Canonical registry name (denormalized for zero-fetch rendering). */
  name: string;
  brand: string | null;
  stage: ProductMatchStage;
  /** 0..1 — deterministic stages ≥ 0.9, fuzzy/llm below (design §1.2). */
  confidence: number;
}

/**
 * Deterministic stages auto-link at/above this confidence; fuzzy and llm
 * proposals always wait for the walkthrough (design §1.2).
 */
export const PRODUCT_AUTO_MATCH_THRESHOLD = 0.9;

/** Max photo size for product images — mirrors the receipt upload cap. */
export const PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Pictures per product (Phase 8.25) — enforced by the API and the dialog. */
export const PRODUCT_IMAGE_MAX_COUNT = 5;

/** Rendition selector for product-image URLs (Phase 8.25). */
export type ProductImageSize = 'full' | 'thumb';

/** One picture of a product (Phase 8.25); position 1 = primary. */
export interface ProductImageInfo {
  id: string;
  position: number;
  /** Cache-busting token, stable per stored file. */
  version: string;
}

/**
 * Registry lookup-key normalization: lowercased, whitespace-collapsed,
 * diacritics-stripped (NFD + combining-mark removal keeps Hebrew/Arabic
 * base letters intact while folding é→e, ü→u). THE dedup/matching rule for
 * both global registries — merchants (Phase 7 §2.3) and products/aliases
 * (Phase 8 §1.2). Kept pure and dependency-free.
 */
export function normalizeLookupName(name: string, maxLength = 200): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Products/aliases store longer names than merchants. */
export const PRODUCT_NAME_MAX_LENGTH = 300;

/**
 * GTIN (EAN/UPC) validation: 8/12/13/14 digits with a valid mod-10 check
 * digit. `normalizeGtin` strips whitespace/hyphens first so scanned and
 * hand-typed codes converge on one storage form.
 */
export function normalizeGtin(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function isValidGtin(raw: string): boolean {
  const code = normalizeGtin(raw);
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  // GS1 mod-10: from the rightmost digit (the check digit) leftwards,
  // weights alternate 1,3,1,3… over the payload.
  let sum = 0;
  for (let i = 0; i < code.length - 1; i++) {
    const digit = code.charCodeAt(code.length - 2 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === code.charCodeAt(code.length - 1) - 48;
}
