// Phase 8 — web-side product wire types (mirror of the API's
// ProductResponseDto family; see apps/api/src/product/dto/product-response.dto.ts).

import type { ProductAliasSource, ProductMatchCandidate } from '@myfinpro/shared';

export interface ProductAlias {
  id: string;
  name: string;
  locale: string | null;
  source: ProductAliasSource;
  confirmationCount: number;
}

/** Caller-scoped purchase stats — always the viewer's own receipts. */
export interface ProductStats {
  timesPurchased: number;
  lastPurchasedAt: string | null;
  lastUnitPriceCents: number | null;
  lastCurrency: string | null;
}

export interface ProductSummary {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  hasImage: boolean;
  /** Cache-busting token for the image endpoint (changes on re-upload). */
  imageVersion: string | null;
  defaultCategoryId: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: ProductStats;
  aliases?: ProductAlias[];
}

export interface ProductListResponse {
  data: ProductSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListProductsParams {
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateProductInput {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  defaultCategoryId?: string | null;
  aliasLocale?: string;
  /** https image fetched in the background (Open Food Facts prefill). */
  imageUrl?: string;
}

/** PATCH /products/:id body — explicit nulls clear nullable fields. */
export interface UpdateProductInput {
  name?: string;
  brand?: string | null;
  barcode?: string | null;
  defaultCategoryId?: string | null;
}

export interface ProductPurchaseRow {
  receiptId: string;
  purchasedAt: string;
  merchantName: string | null;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number;
  currency: string | null;
}

export interface ProductMerchantPrice {
  merchantName: string | null;
  purchases: number;
  lastUnitPriceCents: number | null;
  minUnitPriceCents: number | null;
  maxUnitPriceCents: number | null;
  lastPurchasedAt: string;
}

export interface ProductPurchasesResponse {
  purchases: ProductPurchaseRow[];
  merchants: ProductMerchantPrice[];
}

export interface BarcodeLookupResponse {
  found: boolean;
  product?: ProductSummary;
  prefill?: { name: string | null; brand: string | null; imageUrl: string | null };
  offStatus: 'registry' | 'off' | 'miss' | 'unavailable' | 'disabled';
}

/** POST /receipts/:id/items/:itemId/match body (walkthrough confirm). */
export interface MatchItemInput {
  productId?: string;
  createProduct?: CreateProductInput;
  categoryId?: string;
}

export type { ProductMatchCandidate };
