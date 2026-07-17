import type { ExtractionResult } from '@myfinpro/shared';
import { Injectable, Logger } from '@nestjs/common';
import type {
  ExtractionContext,
  ExtractionInput,
  ExtractionProgressUpdate,
  ReceiptExtractionProvider,
} from './extraction-provider.interface';

/** Spacing of the scripted progress steps — wider than the worker throttle. */
const PROGRESS_STEP_MS = 400;

/**
 * Phase 7, iteration 7.5 — deterministic no-network provider (design §2.5).
 *
 * The default when `RECEIPT_EXTRACTION_PROVIDER` is unset: powers dev, CI,
 * and integration tests at zero cost. Output is a fixed two-item grocery
 * receipt whose numbers reconcile exactly (Σ items − discount === total),
 * with the first candidate category suggested when one is provided.
 *
 * 8.26: when the caller subscribes to progress, a short scripted stage
 * sequence plays out so the transparency UI can be exercised without a
 * paid provider. No subscriber → resolves immediately, as before.
 */
@Injectable()
export class MockExtractionProvider implements ReceiptExtractionProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockExtractionProvider.name);

  async extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult> {
    this.logger.log(`Mock extraction for input kind=${input.kind}`);
    await this.playProgressScript(ctx);
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
          barcode: '7290000066318',
          quantity: 2,
          unitPriceCents: 440,
          discountCents: 0,
          totalCents: 880,
          suggestedCategoryId: categoryId,
          suggestedProductId: productId,
        },
        {
          rawName: 'Tomatoes',
          barcode: null,
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

  /** Scripted stage sequence mirroring a real streaming provider (§4.3). */
  private async playProgressScript(ctx: ExtractionContext): Promise<void> {
    if (!ctx.onProgress) return;
    const script: ExtractionProgressUpdate[] = [
      { stage: 'processing' },
      { stage: 'thinking', thought: 'Reading the merchant header and totals block. ' },
      { stage: 'thinking', thought: 'Two line items; the loyalty discount reconciles.' },
      { stage: 'generating', itemsSoFar: 1 },
      { stage: 'generating', itemsSoFar: 2 },
    ];
    for (const update of script) {
      ctx.onProgress(update);
      await new Promise((resolve) => setTimeout(resolve, PROGRESS_STEP_MS));
    }
  }
}
