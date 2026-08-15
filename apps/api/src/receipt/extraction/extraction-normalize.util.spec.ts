import { validateExtractionResult } from '@myfinpro/shared';
import { normalizeExtractionPayload } from './extraction-normalize.util';

const item = (over: Record<string, unknown> = {}) => ({
  rawName: 'חלב 3%',
  barcode: null,
  quantity: 1,
  unitPriceCents: 790,
  discountCents: 0,
  totalCents: 790,
  suggestedCategoryId: null,
  suggestedProductId: null,
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  merchantName: 'Shufersal',
  purchasedAt: '2026-08-15T10:00:00Z',
  currency: 'ILS',
  totalCents: 790,
  discountCents: 0,
  items: [item()],
  confidence: 'high',
  notes: null,
  ...over,
});

describe('normalizeExtractionPayload', () => {
  it('leaves a clean payload untouched and reports no adjustments', () => {
    const { payload: out, adjustments } = normalizeExtractionPayload(payload());
    expect(adjustments).toEqual([]);
    expect(out).toEqual(payload());
  });

  it('folds printed credit lines into the receipt discount and drops them as items', () => {
    // The production failure: an Israeli supermarket slip prints promotions
    // and basket rebates as their own minus-amount line.
    const { payload: out, adjustments } = normalizeExtractionPayload(
      payload({
        totalCents: 1160,
        discountCents: 0,
        items: [
          item({ rawName: 'במבה 250', totalCents: 300, unitPriceCents: 300 }),
          item({ rawName: 'במבה 250', totalCents: 300, unitPriceCents: 300 }),
          item({ rawName: 'מבצע כפול', quantity: 4, unitPriceCents: null, totalCents: -210 }),
          item({ rawName: 'קניה מעל 90', quantity: 1, unitPriceCents: null, totalCents: -190 }),
          item({ rawName: 'לחם אחיד', totalCents: 960, unitPriceCents: 960 }),
        ],
      }),
    );

    const result = out as { items: { rawName: string }[]; discountCents: number; notes: string };
    expect(result.items.map((i) => i.rawName)).toEqual(['במבה 250', 'במבה 250', 'לחם אחיד']);
    // 2.10 + 1.90 becomes a positive receipt-level discount.
    expect(result.discountCents).toBe(400);
    // Σ items − discount now reconciles against the printed total.
    expect(1560 - result.discountCents).toBe(1160);
    expect(adjustments).toHaveLength(2);
    expect(result.notes).toContain('מבצע כפול');
    expect(validateExtractionResult(out).ok).toBe(true);
  });

  it('adds folded credits on top of an existing receipt discount', () => {
    const { payload: out } = normalizeExtractionPayload(
      payload({ discountCents: 500, items: [item(), item({ totalCents: -250 })] }),
    );
    expect((out as { discountCents: number }).discountCents).toBe(750);
  });

  it('flips negative discounts, unit prices and totals to their magnitude', () => {
    const { payload: out, adjustments } = normalizeExtractionPayload(
      payload({
        totalCents: -790,
        discountCents: -100,
        items: [item({ discountCents: -50, unitPriceCents: -790 })],
      }),
    );
    const result = out as {
      totalCents: number;
      discountCents: number;
      items: { discountCents: number; unitPriceCents: number }[];
    };
    expect(result.totalCents).toBe(790);
    expect(result.discountCents).toBe(100);
    expect(result.items[0]).toMatchObject({ discountCents: 50, unitPriceCents: 790 });
    expect(adjustments).toHaveLength(4);
  });

  it('defaults a non-positive quantity to one', () => {
    const { payload: out } = normalizeExtractionPayload(
      payload({ items: [item({ quantity: 0 })] }),
    );
    expect((out as { items: { quantity: number }[] }).items[0].quantity).toBe(1);
    expect(validateExtractionResult(out).ok).toBe(true);
  });

  it('leaves fractional cents alone — 8.8 could be 9 agorot or 8.80 shekels', () => {
    // Guessing here would silently corrupt the amount; the repair round-trip
    // resolves it against what the model actually read.
    const { payload: out, adjustments } = normalizeExtractionPayload(
      payload({ items: [item({ totalCents: 8.8 })] }),
    );
    expect((out as { items: { totalCents: number }[] }).items[0].totalCents).toBe(8.8);
    expect(adjustments).toEqual([]);
    expect(validateExtractionResult(out).ok).toBe(false);
  });

  it('keeps the provider notes and appends what changed, summarizing long lists', () => {
    const { payload: out } = normalizeExtractionPayload(
      payload({
        notes: 'Bottom of the slip was creased.',
        items: Array.from({ length: 7 }, (_, i) =>
          item({ rawName: `promo ${i}`, totalCents: -100 }),
        ),
      }),
    );
    const notes = (out as { notes: string }).notes;
    expect(notes).toContain('Bottom of the slip was creased.');
    expect(notes).toContain('Adjusted on import');
    expect(notes).toContain('(+2 more)');
  });

  it('passes non-object payloads and malformed items through for the validator to report', () => {
    expect(normalizeExtractionPayload(null).payload).toBeNull();
    expect(normalizeExtractionPayload('nope').payload).toBe('nope');
    const { payload: out } = normalizeExtractionPayload(payload({ items: ['not-an-object'] }));
    expect((out as { items: unknown[] }).items).toEqual(['not-an-object']);
  });
});
