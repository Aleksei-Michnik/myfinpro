/**
 * Deterministic cleanup of provider output, applied BEFORE the shared
 * validator — the middle of the three defences (prompt first, this second,
 * a model repair round-trip only as a last resort).
 *
 * Real receipts print promotions, basket rebates and deposit returns as their
 * own line carrying a MINUS amount ("מבצע כפול −2.10", "spend over 90
 * −1.90"). Transcribed literally those arrive as items with a negative
 * `totalCents`, which the contract forbids — a purchased line cannot cost
 * less than nothing — and a single one of them fails the whole extraction.
 * They are not purchasable lines: the magnitude is folded into the
 * receipt-level discount and the line dropped, which keeps the review page's
 * `Σ items − discount == total` reconciliation intact.
 *
 * Only UNAMBIGUOUS sign fixes belong here. A fractional cent value is left
 * alone on purpose: `8.8` may mean 9 agorot or ₪8.80, and picking one would
 * silently corrupt the amount — that case is what the repair round-trip is
 * for, where the model can reconcile it against what it read.
 */

/** Cap on adjustments spelled out in `notes` before they get summarized. */
const MAX_LISTED_ADJUSTMENTS = 5;

export interface NormalizedExtraction {
  /** The cleaned payload, ready for `validateExtractionResult`. */
  payload: unknown;
  /** Human-readable log of what was changed; empty when nothing was. */
  adjustments: string[];
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Cents → a short human amount for the adjustment log (−210 → "-2.10"). */
const money = (cents: number): string => (cents / 100).toFixed(2);

const nameOf = (item: Record<string, unknown>): string =>
  typeof item.rawName === 'string' && item.rawName.trim() ? item.rawName.trim() : 'unnamed line';

export function normalizeExtractionPayload(input: unknown): NormalizedExtraction {
  const adjustments: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { payload: input, adjustments };
  }
  const source = input as Record<string, unknown>;
  const rawItems = Array.isArray(source.items) ? source.items : null;

  // Magnitude of every dropped credit line, folded into the receipt discount.
  let creditCents = 0;
  const items: unknown[] = [];
  for (const entry of rawItems ?? []) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      items.push(entry); // let the validator report the shape
      continue;
    }
    const item = { ...(entry as Record<string, unknown>) };

    const total = finite(item.totalCents);
    if (total !== null && total < 0) {
      creditCents += -total;
      adjustments.push(`credit line "${nameOf(item)}" (${money(total)}) → receipt discount`);
      continue;
    }

    const discount = finite(item.discountCents);
    if (discount !== null && discount < 0) {
      item.discountCents = -discount;
      adjustments.push(`negative discount on "${nameOf(item)}" → ${money(-discount)}`);
    }
    const unitPrice = finite(item.unitPriceCents);
    if (unitPrice !== null && unitPrice < 0) {
      item.unitPriceCents = -unitPrice;
      adjustments.push(`negative unit price on "${nameOf(item)}" → ${money(-unitPrice)}`);
    }
    const quantity = finite(item.quantity);
    if (
      item.quantity !== undefined &&
      item.quantity !== null &&
      quantity !== null &&
      quantity <= 0
    ) {
      // A line that made it onto the receipt was bought at least once.
      item.quantity = 1;
      adjustments.push(`non-positive quantity on "${nameOf(item)}" → 1`);
    }
    items.push(item);
  }

  const payload: Record<string, unknown> = { ...source };
  if (rawItems) payload.items = items;

  const total = finite(source.totalCents);
  if (total !== null && total < 0) {
    // The grand total of a purchase is the amount paid; a minus is a sign
    // artifact from the printed line, not a negative payment.
    payload.totalCents = -total;
    adjustments.push(`negative receipt total → ${money(-total)}`);
  }

  const discount = finite(source.discountCents);
  let discountCents = discount;
  if (discount !== null && discount < 0) {
    discountCents = -discount;
    adjustments.push(`negative receipt discount → ${money(-discount)}`);
  }
  if (creditCents > 0) discountCents = (discountCents ?? 0) + creditCents;
  if (discountCents !== discount) payload.discountCents = discountCents;

  if (adjustments.length > 0) {
    payload.notes = appendToNotes(source.notes, adjustments);
  }
  return { payload, adjustments };
}

/** Keep the provider's own notes and append what we changed underneath. */
function appendToNotes(existing: unknown, adjustments: string[]): string {
  const listed = adjustments.slice(0, MAX_LISTED_ADJUSTMENTS);
  const overflow = adjustments.length - listed.length;
  const summary = [
    `Adjusted on import: ${listed.join('; ')}`,
    overflow > 0 ? ` (+${overflow} more)` : '',
  ].join('');
  return typeof existing === 'string' && existing.trim()
    ? `${existing.trim()}\n${summary}`
    : summary;
}
