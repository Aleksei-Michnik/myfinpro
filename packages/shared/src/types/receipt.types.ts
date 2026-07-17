// Phase 7: Receipt Ingestion & LLM Extraction — shared enums, the
// extraction-result contract, and its structural validator.
// Used by apps/api (worker + provider layer + DTO validation) and
// apps/web (status pills, review forms).
// See docs/phase-7-receipts-design.md §2 and §6.3.

export const RECEIPT_STATUSES = [
  'UPLOADED',
  'EXTRACTING',
  'REVIEW',
  'CONFIRMED',
  'FAILED',
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_SOURCES = ['upload', 'url', 'manual'] as const;
export type ReceiptSource = (typeof RECEIPT_SOURCES)[number];

/**
 * MIME whitelist for uploaded receipt files (design §5). Detection happens
 * server-side from magic bytes — the client-declared type is advisory only.
 */
export const RECEIPT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;
export type ReceiptMimeType = (typeof RECEIPT_ALLOWED_MIME_TYPES)[number];

/** 10 MB — mirrors the Phase 0 file-upload security baseline. */
export const RECEIPT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Phase 8.22 — one receipt may span several photos (a long slip shot in
 * overlapping segments). Pages are images only; PDFs stay single-file.
 */
export const RECEIPT_MAX_FILES = 8;

export const EXTRACTION_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ExtractionConfidence = (typeof EXTRACTION_CONFIDENCES)[number];

/** One extracted line item. All money values are integer cents. */
export interface ExtractedItem {
  rawName: string;
  /**
   * Phase 8.21 — product code printed on the line (EAN/UPC digits), or
   * null. Feeds the barcode stage of the matcher exactly like a manually
   * scanned code; short internal store codes are not barcodes.
   */
  barcode: string | null;
  /** Decimal quantities are legit (e.g. 0.732 kg). */
  quantity: number;
  unitPriceCents: number | null;
  /** Line-level discount, ≥ 0. */
  discountCents: number;
  /** Line total AFTER discount. */
  totalCents: number;
  /**
   * Suggested category — MUST be one of the candidate ids handed to the
   * provider in the extraction context, or null.
   */
  suggestedCategoryId: string | null;
  /**
   * Phase 8 — product match ranked by the extraction LLM. MUST be one of
   * the product-candidate ids handed to the provider, or null. This is the
   * cross-language stage of the matcher (design §1.2).
   */
  suggestedProductId: string | null;
}

/**
 * The structured output contract every extraction provider must satisfy
 * (design §6.3). Header fields are nullable — a blurry photo may only
 * yield items, or only a total.
 */
export interface ExtractionResult {
  merchantName: string | null;
  /** ISO 8601 datetime. */
  purchasedAt: string | null;
  /** ISO 4217 code guess. */
  currency: string | null;
  totalCents: number | null;
  /** Receipt-level discount (on top of per-line discounts), ≥ 0. */
  discountCents: number | null;
  items: ExtractedItem[];
  confidence: ExtractionConfidence;
  /** Free-text caveats from the provider (unreadable zones etc.). */
  notes: string | null;
}

/** Failure shape returned by {@link validateExtractionResult}. */
export interface ExtractionValidationError {
  path: string;
  message: string;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isIntOrNull = (v: unknown): v is number | null => v === null || isInt(v);

/**
 * Structural validator for provider output. LLMs occasionally return
 * shapes that drift from the schema despite structured-output modes — the
 * worker validates BEFORE anything touches the database and fails the
 * extraction (not the process) on drift.
 *
 * Deliberately dependency-free (no zod in the shared package): the shape
 * is small and stable, and both workspaces can run this in any runtime.
 */
export function validateExtractionResult(value: unknown): {
  ok: boolean;
  errors: ExtractionValidationError[];
  result?: ExtractionResult;
} {
  const errors: ExtractionValidationError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: [{ path: '', message: 'must be an object' }] };
  }
  const v = value as Record<string, unknown>;

  if (!isStringOrNull(v.merchantName)) fail('merchantName', 'must be string or null');
  if (!isStringOrNull(v.purchasedAt)) fail('purchasedAt', 'must be string or null');
  else if (typeof v.purchasedAt === 'string' && Number.isNaN(Date.parse(v.purchasedAt))) {
    fail('purchasedAt', 'must be a parseable ISO 8601 datetime');
  }
  if (!isStringOrNull(v.currency)) fail('currency', 'must be string or null');
  else if (typeof v.currency === 'string' && !/^[A-Za-z]{3}$/.test(v.currency)) {
    fail('currency', 'must be a 3-letter ISO 4217 code');
  }
  if (!isIntOrNull(v.totalCents)) fail('totalCents', 'must be integer cents or null');
  else if (typeof v.totalCents === 'number' && v.totalCents < 0) {
    fail('totalCents', 'must be ≥ 0');
  }
  if (!isIntOrNull(v.discountCents)) fail('discountCents', 'must be integer cents or null');
  else if (typeof v.discountCents === 'number' && v.discountCents < 0) {
    fail('discountCents', 'must be ≥ 0');
  }
  if (
    v.confidence !== undefined &&
    !(EXTRACTION_CONFIDENCES as readonly unknown[]).includes(v.confidence)
  ) {
    fail('confidence', `must be one of ${EXTRACTION_CONFIDENCES.join(', ')}`);
  }
  if (!isStringOrNull(v.notes ?? null)) fail('notes', 'must be string or null');

  if (!Array.isArray(v.items)) {
    fail('items', 'must be an array');
  } else {
    v.items.forEach((item, i) => {
      const p = `items[${i}]`;
      if (typeof item !== 'object' || item === null) {
        fail(p, 'must be an object');
        return;
      }
      const it = item as Record<string, unknown>;
      if (typeof it.rawName !== 'string' || it.rawName.trim().length === 0) {
        fail(`${p}.rawName`, 'must be a non-empty string');
      }
      if (!isStringOrNull(it.barcode ?? null)) {
        fail(`${p}.barcode`, 'must be string or null');
      }
      if (!isFiniteNumber(it.quantity) || (it.quantity as number) <= 0) {
        fail(`${p}.quantity`, 'must be a positive number');
      }
      if (!isIntOrNull(it.unitPriceCents ?? null)) {
        fail(`${p}.unitPriceCents`, 'must be integer cents or null');
      }
      const discount = it.discountCents ?? 0;
      if (!isInt(discount) || discount < 0) {
        fail(`${p}.discountCents`, 'must be a non-negative integer');
      }
      if (!isInt(it.totalCents) || (it.totalCents as number) < 0) {
        fail(`${p}.totalCents`, 'must be non-negative integer cents');
      }
      if (!isStringOrNull(it.suggestedCategoryId ?? null)) {
        fail(`${p}.suggestedCategoryId`, 'must be string or null');
      }
      if (!isStringOrNull(it.suggestedProductId ?? null)) {
        fail(`${p}.suggestedProductId`, 'must be string or null');
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const items = (v.items as Record<string, unknown>[]).map(
    (it): ExtractedItem => ({
      rawName: (it.rawName as string).trim(),
      barcode: ((it.barcode as string | null) ?? null)?.trim() || null,
      quantity: it.quantity as number,
      unitPriceCents: (it.unitPriceCents ?? null) as number | null,
      discountCents: (it.discountCents ?? 0) as number,
      totalCents: it.totalCents as number,
      suggestedCategoryId: (it.suggestedCategoryId ?? null) as string | null,
      suggestedProductId: (it.suggestedProductId ?? null) as string | null,
    }),
  );
  return {
    ok: true,
    errors: [],
    result: {
      merchantName: (v.merchantName as string | null)?.trim() || null,
      purchasedAt: (v.purchasedAt ?? null) as string | null,
      currency: v.currency ? (v.currency as string).toUpperCase() : null,
      totalCents: (v.totalCents ?? null) as number | null,
      discountCents: (v.discountCents ?? null) as number | null,
      items,
      confidence: (v.confidence ?? 'low') as ExtractionConfidence,
      notes: (v.notes ?? null) as string | null,
    },
  };
}

/**
 * The single category that best represents a receipt for transaction
 * reconciliation (Phase 8.15) — the categorised line items' category with
 * the largest summed spend. Ties break by first appearance. Returns null
 * when no line carries a category. Used by both the reconcile endpoint
 * (what `applyCategory` writes) and the web reconcile dialog (what it
 * offers), so the two never disagree.
 */
export function dominantReceiptCategoryId(
  items: Array<{ categoryId: string | null; totalCents: number }>,
): string | null {
  const spendByCategory = new Map<string, number>();
  for (const item of items) {
    if (!item.categoryId) continue;
    spendByCategory.set(
      item.categoryId,
      (spendByCategory.get(item.categoryId) ?? 0) + item.totalCents,
    );
  }
  let winner: string | null = null;
  let best = -1;
  for (const [categoryId, spend] of spendByCategory) {
    if (spend > best) {
      best = spend;
      winner = categoryId;
    }
  }
  return winner;
}

/**
 * Sum of item totals minus the receipt-level discount vs. the extracted
 * total — the review UI shows a warning when they diverge (never a hard
 * block; real receipts carry rounding, deposits, and tips).
 */
export function computeTotalsMismatch(result: {
  totalCents: number | null;
  discountCents: number | null;
  items: Array<{ totalCents: number }>;
}): { itemsSumCents: number; mismatchCents: number | null } {
  const itemsSumCents = result.items.reduce((s, i) => s + i.totalCents, 0);
  if (result.totalCents === null) return { itemsSumCents, mismatchCents: null };
  const expected = itemsSumCents - (result.discountCents ?? 0);
  return { itemsSumCents, mismatchCents: result.totalCents - expected };
}

/**
 * Phase 8.26 — live extraction progress stages (design §4.1). Ephemeral by
 * construction: events ride the in-memory SSE bus, feed no DTO and no DB
 * column, and thought text is never logged or persisted.
 */
export const RECEIPT_EXTRACTION_STAGES = [
  'preparing', // worker: reading pages / resolving the URL
  'sending', // provider resolved; request about to open
  'processing', // request open, no tokens yet
  'thinking', // reasoning-summary deltas arriving (capability-gated)
  'generating', // output tokens arriving
  'continuing', // chunked continuation pass (8.21)
] as const;
export type ReceiptExtractionStage = (typeof RECEIPT_EXTRACTION_STAGES)[number];

/** One transient `receipt.extraction.progress` payload (Phase 8.26). */
export interface ReceiptExtractionProgress {
  stage: ReceiptExtractionStage;
  /** Resolved provider/model — null on the deployment-default binding. */
  provider: string | null;
  model: string | null;
  /** New reasoning-summary text since the last event (throttled, capped). */
  thought?: string;
  /** Line items observed in the output stream so far. */
  itemsSoFar?: number;
  /** 1-based continuation pass (stage 'continuing'). */
  pass?: number;
}
