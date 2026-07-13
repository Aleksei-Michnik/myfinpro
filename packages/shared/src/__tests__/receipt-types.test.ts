// Phase 7, iteration 7.1 — receipt enums + the extraction-result validator.

import {
  computeTotalsMismatch,
  dominantReceiptCategoryId,
  EXTRACTION_CONFIDENCES,
  RECEIPT_ALLOWED_MIME_TYPES,
  RECEIPT_MAX_FILE_SIZE_BYTES,
  RECEIPT_SOURCES,
  RECEIPT_STATUSES,
  validateExtractionResult,
} from '../types/receipt.types';

const validResult = () => ({
  merchantName: '  Shufersal Deal  ',
  purchasedAt: '2026-07-01T17:42:00.000Z',
  currency: 'ils',
  totalCents: 12345,
  discountCents: 500,
  items: [
    {
      rawName: 'Milk 3%',
      quantity: 2,
      unitPriceCents: 690,
      discountCents: 0,
      totalCents: 1380,
      suggestedCategoryId: 'cat-1',
      suggestedProductId: 'prod-1',
    },
    {
      rawName: 'Tomatoes',
      quantity: 0.732,
      unitPriceCents: null,
      discountCents: 120,
      totalCents: 880,
      suggestedCategoryId: null,
      suggestedProductId: null,
    },
  ],
  confidence: 'high',
  notes: null,
});

describe('receipt shared types', () => {
  it('exposes the lifecycle statuses in order', () => {
    expect(RECEIPT_STATUSES).toEqual(['UPLOADED', 'EXTRACTING', 'REVIEW', 'CONFIRMED', 'FAILED']);
    expect(RECEIPT_SOURCES).toEqual(['upload', 'url', 'manual']);
    expect(EXTRACTION_CONFIDENCES).toEqual(['high', 'medium', 'low']);
  });

  it('whitelists exactly the design §5 MIME types with a 10MB cap', () => {
    expect(RECEIPT_ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(RECEIPT_ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(RECEIPT_ALLOWED_MIME_TYPES).not.toContain('image/gif');
    expect(RECEIPT_MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('dominantReceiptCategoryId', () => {
  it('picks the category with the largest summed spend', () => {
    expect(
      dominantReceiptCategoryId([
        { categoryId: 'a', totalCents: 300 },
        { categoryId: 'b', totalCents: 500 },
        { categoryId: 'a', totalCents: 400 }, // a: 700 > b: 500
      ]),
    ).toBe('a');
  });

  it('ignores uncategorised lines and returns null when none carry a category', () => {
    expect(
      dominantReceiptCategoryId([
        { categoryId: null, totalCents: 900 },
        { categoryId: 'x', totalCents: 100 },
      ]),
    ).toBe('x');
    expect(dominantReceiptCategoryId([{ categoryId: null, totalCents: 900 }])).toBeNull();
    expect(dominantReceiptCategoryId([])).toBeNull();
  });

  it('breaks ties by first appearance', () => {
    expect(
      dominantReceiptCategoryId([
        { categoryId: 'first', totalCents: 500 },
        { categoryId: 'second', totalCents: 500 },
      ]),
    ).toBe('first');
  });
});

describe('validateExtractionResult', () => {
  it('accepts a valid result and normalizes it', () => {
    const r = validateExtractionResult(validResult());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    // Normalization: trimmed merchant, uppercased currency.
    expect(r.result!.merchantName).toBe('Shufersal Deal');
    expect(r.result!.currency).toBe('ILS');
    expect(r.result!.items).toHaveLength(2);
    expect(r.result!.items[1].quantity).toBeCloseTo(0.732);
  });

  it('defaults omitted optional fields (confidence, notes, item discount)', () => {
    const input = validResult() as Record<string, unknown>;
    delete input.confidence;
    delete input.notes;
    delete (input.items as Record<string, unknown>[])[0].discountCents;
    delete (input.items as Record<string, unknown>[])[0].suggestedCategoryId;
    // Pre-Phase-8 payloads have no suggestedProductId — must stay valid.
    delete (input.items as Record<string, unknown>[])[0].suggestedProductId;
    const r = validateExtractionResult(input);
    expect(r.ok).toBe(true);
    expect(r.result!.confidence).toBe('low');
    expect(r.result!.notes).toBeNull();
    expect(r.result!.items[0].discountCents).toBe(0);
    expect(r.result!.items[0].suggestedCategoryId).toBeNull();
    expect(r.result!.items[0].suggestedProductId).toBeNull();
    expect(r.result!.items[1].suggestedProductId).toBeNull();
  });

  it('rejects a non-string suggestedProductId', () => {
    const input = validResult() as Record<string, unknown>;
    (input.items as Record<string, unknown>[])[0].suggestedProductId = 42;
    const r = validateExtractionResult(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'items[0].suggestedProductId')).toBe(true);
  });

  it('accepts an all-null header (blurry photo with only items)', () => {
    const r = validateExtractionResult({
      merchantName: null,
      purchasedAt: null,
      currency: null,
      totalCents: null,
      discountCents: null,
      items: [],
      confidence: 'low',
      notes: 'unreadable header',
    });
    expect(r.ok).toBe(true);
  });

  it.each([
    ['non-object', 42, ''],
    ['array', [], ''],
    ['bad purchasedAt', { ...validResult(), purchasedAt: 'yesterday' }, 'purchasedAt'],
    ['bad currency', { ...validResult(), currency: 'shekels' }, 'currency'],
    ['float totalCents', { ...validResult(), totalCents: 12.5 }, 'totalCents'],
    ['negative total', { ...validResult(), totalCents: -1 }, 'totalCents'],
    ['negative discount', { ...validResult(), discountCents: -5 }, 'discountCents'],
    ['bad confidence', { ...validResult(), confidence: 'sure' }, 'confidence'],
    ['items not array', { ...validResult(), items: {} }, 'items'],
  ])('rejects %s', (_label, input, path) => {
    const r = validateExtractionResult(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path.startsWith(path))).toBe(true);
  });

  it.each([
    ['empty rawName', { rawName: '  ' }, 'rawName'],
    ['zero quantity', { quantity: 0 }, 'quantity'],
    ['negative quantity', { quantity: -1 }, 'quantity'],
    ['float line total', { totalCents: 10.5 }, 'totalCents'],
    ['float unit price', { unitPriceCents: 6.9 }, 'unitPriceCents'],
    ['negative line discount', { discountCents: -1 }, 'discountCents'],
  ])('rejects an item with %s', (_label, patch, field) => {
    const input = validResult();
    Object.assign(input.items[0], patch);
    const r = validateExtractionResult(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === `items[0].${field}`)).toBe(true);
  });

  it('collects multiple errors with precise paths', () => {
    const input = validResult();
    input.currency = 'x' as never;
    Object.assign(input.items[1], { quantity: 0 });
    const r = validateExtractionResult(input);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.path).sort()).toEqual(['currency', 'items[1].quantity']);
  });
});

describe('computeTotalsMismatch', () => {
  it('reports zero mismatch when items − discount equals the total', () => {
    const { itemsSumCents, mismatchCents } = computeTotalsMismatch({
      totalCents: 1760,
      discountCents: 500,
      items: [{ totalCents: 1380 }, { totalCents: 880 }],
    });
    expect(itemsSumCents).toBe(2260);
    expect(mismatchCents).toBe(0);
  });

  it('reports the signed difference on divergence', () => {
    const { mismatchCents } = computeTotalsMismatch({
      totalCents: 2000,
      discountCents: 0,
      items: [{ totalCents: 1380 }, { totalCents: 880 }],
    });
    expect(mismatchCents).toBe(-260); // total is 260 LESS than the items sum
  });

  it('returns null mismatch when no total was extracted', () => {
    const { itemsSumCents, mismatchCents } = computeTotalsMismatch({
      totalCents: null,
      discountCents: null,
      items: [{ totalCents: 100 }],
    });
    expect(itemsSumCents).toBe(100);
    expect(mismatchCents).toBeNull();
  });
});
