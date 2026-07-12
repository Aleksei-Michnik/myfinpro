import type { ExtractionResult } from '@myfinpro/shared';

/**
 * Phase 7, iteration 7.5 — the pluggable extraction provider contract
 * (design §2.5). Implementations MUST return a value that passes the shared
 * `validateExtractionResult` — the worker re-validates before anything
 * touches the database, so drift fails the extraction, not the process.
 */

/** What the worker hands the provider. */
export type ExtractionInput =
  | { kind: 'image'; data: Buffer; mimeType: string }
  | { kind: 'pdf'; data: Buffer }
  /** Text/HTML snapshot of an online receipt (source=url). */
  | { kind: 'html'; data: string; sourceUrl: string };

/** One category candidate the provider may classify items into. */
export interface CategoryCandidate {
  id: string;
  name: string;
}

/** One registry product the provider may rank item matches against (8.3). */
export interface ProductCandidate {
  id: string;
  name: string;
  brand: string | null;
}

export interface ExtractionContext {
  /**
   * The uploader's visible OUT-direction categories. `suggestedCategoryId`
   * values in the result MUST come from this list (or be null) — the worker
   * drops anything else.
   */
  categories: CategoryCandidate[];
  /**
   * Phase 8 — the uploader's recently purchased registry products.
   * `suggestedProductId` values MUST come from this list (or be null);
   * this is the cross-language matching stage (design §1.2).
   */
  products: ProductCandidate[];
  /** BCP-47 hint for date/number disambiguation (e.g. 'he-IL'). */
  locale?: string;
}

export interface ReceiptExtractionProvider {
  readonly name: string;
  extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult>;
}

/** Nest DI token — bound by the factory in receipt.module.ts. */
export const RECEIPT_EXTRACTION_PROVIDER = Symbol('RECEIPT_EXTRACTION_PROVIDER');

/**
 * Thrown by providers for PERMANENT failures (unsupported input kind,
 * schema-invalid output after validation, provider-side content rejection).
 * The resilience wrapper does not retry these; the worker fails the receipt
 * with the message as `failureReason`.
 */
export class ExtractionFailedError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExtractionFailedError';
  }
}
