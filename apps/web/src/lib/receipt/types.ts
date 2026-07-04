// Phase 7 · Iteration 7.7 — web-side receipt wire types (mirror of the API's
// ReceiptResponseDto; see apps/api/src/receipt/dto/receipt-response.dto.ts).

export const RECEIPT_STATUSES = [
  'UPLOADED',
  'EXTRACTING',
  'REVIEW',
  'CONFIRMED',
  'FAILED',
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export type ReceiptSource = 'upload' | 'url';

export interface ReceiptItem {
  id: string;
  position: number;
  rawName: string;
  quantity: number;
  unitPriceCents: number | null;
  discountCents: number;
  totalCents: number;
  categoryId: string | null;
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
  paymentId: string | null;
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
