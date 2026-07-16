// Phase 7 · Iteration 7.7 — web-side receipt wire types (mirror of the API's
// ReceiptResponseDto; see apps/api/src/receipt/dto/receipt-response.dto.ts).
// Phase 8 adds the product-match fields on items.

import type { AttributionScope, ProductMatchCandidate, ProductMatchStatus } from '@myfinpro/shared';

export const RECEIPT_STATUSES = [
  'UPLOADED',
  'EXTRACTING',
  'REVIEW',
  'CONFIRMED',
  'FAILED',
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export type ReceiptSource = 'upload' | 'url' | 'manual';

export interface ReceiptItem {
  id: string;
  position: number;
  rawName: string;
  /** Product code read off the printed line (normalized GTIN), 8.21. */
  barcode: string | null;
  quantity: number;
  unitPriceCents: number | null;
  discountCents: number;
  totalCents: number;
  categoryId: string | null;
  /** Phase 8 — registry link + walkthrough state. */
  productId: string | null;
  productName: string | null;
  productBrand: string | null;
  matchStatus: ProductMatchStatus;
  matchCandidates: ProductMatchCandidate[];
}

export interface ReceiptSummary {
  id: string;
  status: ReceiptStatus;
  source: ReceiptSource;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceUrl: string | null;
  merchantId: string | null;
  merchantName: string | null;
  extractedMerchantName: string | null;
  /** ISO 8601 datetime. */
  purchasedAt: string | null;
  currency: string | null;
  totalCents: number | null;
  discountCents: number | null;
  failureReason: string | null;
  transactionId: string | null;
  itemsSumCents: number;
  /** Advisory Σitems-vs-total delta; non-zero renders a review warning. */
  totalsMismatchCents: number | null;
  createdAt: string;
  updatedAt: string;
  items: ReceiptItem[];
}

export interface ReceiptListResponse {
  data: ReceiptSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListReceiptsParams {
  status?: ReceiptStatus;
  limit?: number;
  cursor?: string;
}

export interface ReceiptItemInput {
  rawName: string;
  quantity: number;
  unitPriceCents?: number | null;
  discountCents?: number;
  totalCents: number;
  categoryId?: string | null;
}

/** PATCH /receipts/:id body — explicit nulls clear nullable fields. */
export interface UpdateReceiptInput {
  extractedMerchantName?: string | null;
  merchantId?: string | null;
  purchasedAt?: string | null;
  currency?: string | null;
  totalCents?: number | null;
  discountCents?: number | null;
}

export interface MerchantSuggestion {
  id: string;
  name: string;
}

/** POST /receipts/manual body — a receipt composed by scanning products (8.14). */
export interface ManualReceiptInput {
  currency: string;
  merchantName?: string;
  /** ISO 8601; the API defaults to now. */
  purchasedAt?: string;
  items: Array<{ productId: string; quantity: number; unitPriceCents: number }>;
}

/** POST /receipts/:id/confirm body — turns a reviewed receipt into a transaction. */
export interface ConfirmReceiptInput {
  /** Primary OUT category for the resulting transaction. */
  categoryId: string;
  /** Attribution scopes to remember (personal / group), mirrors POST /transactions. */
  attributions: AttributionScope[];
  note?: string;
}
