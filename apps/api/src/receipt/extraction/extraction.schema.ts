/**
 * Phase 7, iteration 7.5 — JSON schema handed to providers' structured-output
 * modes. Mirrors the shared `ExtractionResult` contract (§6.3) within the
 * structured-outputs subset: every object carries `additionalProperties:
 * false` + `required`, and numeric range checks are left to the shared
 * validator (`validateExtractionResult`) which the worker runs regardless.
 */
/**
 * Output-token ceiling for the extraction call, shared by both providers.
 * A real grocery receipt runs to dozens of line items, and on Anthropic the
 * model's adaptive thinking spends from the SAME budget — 8192 (Phase 8.17)
 * and then 16384 (8.21, a ~50-line receipt on Sonnet 5's denser tokenizer)
 * both truncated mid-JSON, surfacing as a "non-JSON output" parse failure.
 * 64K forces streaming on the Anthropic SDK (HTTP-timeout guidance >16K);
 * providers must also surface truncation as its own error, not a parse one.
 */
export const EXTRACTION_MAX_OUTPUT_TOKENS = 64_000;

export const EXTRACTION_RESULT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'merchantName',
    'purchasedAt',
    'currency',
    'totalCents',
    'discountCents',
    'items',
    'confidence',
    'notes',
  ],
  properties: {
    merchantName: {
      type: ['string', 'null'],
      description: 'The store/place name exactly as printed, or null if unreadable.',
    },
    purchasedAt: {
      type: ['string', 'null'],
      description: 'Purchase date-time as ISO 8601 (e.g. 2026-07-01T17:42:00Z), or null.',
    },
    currency: {
      type: ['string', 'null'],
      description: 'ISO 4217 code inferred from symbols/text (₪→ILS, $→USD, €→EUR), or null.',
    },
    totalCents: {
      type: ['integer', 'null'],
      description: 'Grand total paid, in integer cents/agorot. 45.90 → 4590. Never negative.',
    },
    discountCents: {
      type: ['integer', 'null'],
      description:
        'Receipt-level discount total in integer cents (NOT per-line), as a POSITIVE number, ' +
        'or null. Basket-wide rebates printed as a minus line (e.g. "spend over 90 −1.90") ' +
        'belong here as +190.',
    },
    items: {
      type: 'array',
      description: 'Every line item on the receipt, in printed order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'rawName',
          'barcode',
          'quantity',
          'unitPriceCents',
          'discountCents',
          'totalCents',
          'suggestedCategoryId',
          'suggestedProductId',
        ],
        properties: {
          rawName: {
            type: 'string',
            description: 'Item name exactly as printed (keep original language).',
          },
          barcode: {
            type: ['string', 'null'],
            description:
              'Product barcode digits printed on/near the line (EAN/UPC, 8–14 digits, e.g. ' +
              '7290119381043), or null. Short internal store codes (1–7 digits) are NOT barcodes.',
          },
          quantity: {
            type: 'number',
            description: 'Quantity; decimals allowed for weighed goods (0.732 kg → 0.732).',
          },
          unitPriceCents: {
            type: ['integer', 'null'],
            description: 'Unit price in integer cents, or null when not printed.',
          },
          discountCents: {
            type: 'integer',
            description:
              'Line-level discount in integer cents as a POSITIVE number, 0 when none. ' +
              'A promotion printed under the line it discounts belongs here.',
          },
          totalCents: {
            type: 'integer',
            description:
              'Line total AFTER discount, integer cents. NEVER negative: a printed minus line ' +
              '(promotion, credit, deposit return) is not an item — fold it into a discount.',
          },
          suggestedCategoryId: {
            type: ['string', 'null'],
            description:
              'The id of the best-matching category from the provided candidate list, or null. NEVER invent ids.',
          },
          suggestedProductId: {
            type: ['string', 'null'],
            description:
              'The id of the known product this line most likely is, from the provided product ' +
              'list, or null. Match across languages (e.g. a Hebrew line for an English-named ' +
              'product). NEVER invent ids.',
          },
        },
      },
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'Overall extraction confidence.',
    },
    notes: {
      type: ['string', 'null'],
      description: 'Caveats: unreadable zones, guessed values, ambiguous dates. Null if none.',
    },
  },
} as const;

/** Builds the instruction prompt shared by the real providers. */
export function buildExtractionPrompt(ctx: {
  categories: { id: string; name: string }[];
  products: { id: string; name: string; brand: string | null }[];
  locale?: string;
}): string {
  const categoryList =
    ctx.categories.length > 0
      ? ctx.categories.map((c) => `- ${c.id}: ${c.name}`).join('\n')
      : '(no candidates provided — use null for every suggestedCategoryId)';
  const productList =
    ctx.products.length > 0
      ? ctx.products.map((p) => `- ${p.id}: ${p.name}${p.brand ? ` (${p.brand})` : ''}`).join('\n')
      : '(no known products — use null for every suggestedProductId)';
  return [
    'Extract the receipt data from the attached document.',
    '',
    'Rules:',
    '- Several attached photos are consecutive segments of ONE long receipt, in order,',
    '  possibly overlapping at the seams — extract each line item exactly once.',
    '- All money values are INTEGER cents (45.90 → 4590). Never use floats for money.',
    '- NEVER return a negative number. Every amount is zero or greater.',
    '- A line printed with a MINUS amount is a discount, not a purchase: promotions',
    '  ("מבצע", "הנחה", "2 for 20"), credits, refunds and deposit returns. Do NOT emit it as its',
    '  own item. Subtract it instead: add its magnitude to the discountCents of the item(s) it',
    '  applies to and lower their totalCents to match. When it applies to the whole basket',
    '  (e.g. "spend over 90"), add the magnitude to the receipt-level discountCents.',
    '- Weighed goods (0.825 kg × 7.90): round the line total to the nearest whole cent.',
    '- Keep item names exactly as printed, in their original language.',
    '- Many receipts print a product barcode (EAN/UPC, 8–14 digits) next to each line — return',
    '  it in barcode. Short internal store codes (1–7 digits) are not barcodes; use null.',
    '- Line totals are AFTER line-level discounts; receipt-level discounts go in discountCents.',
    '- Dates: prefer an explicit printed date/time; return ISO 8601. When the day/month order is' +
      ` ambiguous, assume the ${ctx.locale ?? 'en'} locale convention.`,
    '- For each item pick the best-matching category id from the candidates below, or null.',
    '  Never invent ids that are not in the list.',
    '- For each item also check whether the line refers to one of the known products below and',
    '  set suggestedProductId accordingly, or null. Product names may be in a DIFFERENT language',
    '  than the receipt line — match by meaning (e.g. "חלב 3%" ↔ "Milk 3%"), brand, and size.',
    '  Only suggest a product when you are reasonably sure; never invent ids.',
    '- If part of the receipt is unreadable, extract what you can, lower the confidence, and',
    '  describe the gap in notes.',
    '',
    'Category candidates:',
    categoryList,
    '',
    'Known products:',
    productList,
  ].join('\n');
}

/**
 * Last-resort repair round-trip: the model is shown the validation errors its
 * own output produced and asked to correct them. Costs a second call, so it
 * only runs after deterministic normalization has failed to rescue the
 * payload. The document is deliberately NOT re-sent — this is a formatting
 * fix on text the model already produced, not a re-read.
 */
export function buildRepairPrompt(
  invalidJson: string,
  errors: { path: string; message: string }[],
): string {
  return [
    'The JSON you returned for this receipt was REJECTED by our validator.',
    '',
    'Problems found:',
    ...errors.map((e) => `- ${e.path || '(root)'}: ${e.message}`),
    '',
    'Return the COMPLETE corrected JSON in the same schema. Fix only the listed problems and',
    'keep everything else byte-identical — do not drop, reorder or re-word any other line item.',
    '',
    'Reminders:',
    '- Money is INTEGER cents: 8.80 shekels → 880, never 8.8 and never a fraction.',
    '- No amount may be negative. A minus-signed line (promotion, credit, deposit return) is not',
    '  an item: put its magnitude in the discountCents of the item it applies to, or in the',
    '  receipt-level discountCents when it applies to the whole basket.',
    '- quantity must be greater than zero.',
    '',
    'The rejected JSON:',
    invalidJson,
  ].join('\n');
}
