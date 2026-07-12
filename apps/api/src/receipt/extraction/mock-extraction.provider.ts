import type { ExtractionResult } from '@myfinpro/shared';
import { Injectable, Logger } from '@nestjs/common';
import type {
  ExtractionContext,
  ExtractionInput,
  ReceiptExtractionProvider,
} from './extraction-provider.interface';

/**
 * Phase 7, iteration 7.5 — deterministic no-network provider (design §2.5).
 *
 * The default when `RECEIPT_EXTRACTION_PROVIDER` is unset: powers dev, CI,
 * and integration tests at zero cost. Output is a fixed two-item grocery
 * receipt whose numbers reconcile exactly (Σ items − discount === total),
 * with the first candidate category suggested when one is provided.
 */
@Injectable()
export class MockExtractionProvider implements ReceiptExtractionProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockExtractionProvider.name);

  extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult> {
    this.logger.log(`Mock extraction for input kind=${input.kind}`);
    const categoryId = ctx.categories[0]?.id ?? null;
    // Deterministic LLM-stage fixture: the first known product is "matched"
    // to the first line, mirroring how a real provider ranks candidates.
    const productId = ctx.products[0]?.id ?? null;
    return Promise.resolve({
      merchantName: 'Mock Grocery',
      purchasedAt: '2026-07-01T12:00:00.000Z',
      currency: 'USD',
      totalCents: 1660,
      discountCents: 100,
      items: [
        {
          rawName: 'Milk 3%',
          quantity: 2,
          unitPriceCents: 440,
          discountCents: 0,
          totalCents: 880,
          suggestedCategoryId: categoryId,
          suggestedProductId: productId,
        },
        {
          rawName: 'Tomatoes',
          quantity: 0.8,
          unitPriceCents: 1100,
          discountCents: 0,
          totalCents: 880,
          suggestedCategoryId: categoryId,
          suggestedProductId: null,
        },
      ],
      confidence: 'high',
      notes: 'mock provider — deterministic fixture',
    });
  }
}
