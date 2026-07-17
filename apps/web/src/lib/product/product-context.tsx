'use client';

// Phase 8 — ProductProvider (the receipt-context conventions: every method
// takes an optional AbortSignal, errors are rich ApiError-shaped objects).

import type { ProductImageInfo, ProductImageSize } from '@myfinpro/shared';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type {
  BarcodeLookupResponse,
  CreateProductInput,
  ListProductsParams,
  ProductListResponse,
  ProductPurchasesResponse,
  ProductSummary,
  UpdateProductInput,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';

export interface ProductApiError extends Error {
  errorCode?: string;
  status?: number;
}

interface ProductContextValue {
  /** Registry search (with `search`) or "my products" page (without). */
  fetchProducts(params?: ListProductsParams, signal?: AbortSignal): Promise<ProductListResponse>;
  getProduct(id: string, signal?: AbortSignal): Promise<ProductSummary>;
  /** The caller's purchase history + per-merchant prices. */
  fetchPurchases(id: string, signal?: AbortSignal): Promise<ProductPurchasesResponse>;
  createProduct(input: CreateProductInput, signal?: AbortSignal): Promise<ProductSummary>;
  updateProduct(
    id: string,
    patch: UpdateProductInput,
    signal?: AbortSignal,
  ): Promise<ProductSummary>;
  addAlias(
    id: string,
    input: { name: string; locale?: string },
    signal?: AbortSignal,
  ): Promise<ProductSummary>;
  /** Local registry → Open Food Facts prefill → manual entry. */
  lookupBarcode(code: string, signal?: AbortSignal): Promise<BarcodeLookupResponse>;
  /** Multipart upload; renditions land in the background (≤5 per product). */
  uploadImage(id: string, file: File, signal?: AbortSignal): Promise<ProductImageInfo>;
  /** Remove one picture; the survivors renumber contiguously. */
  removeImage(id: string, imageId: string, signal?: AbortSignal): Promise<void>;
  /** Move a picture to a position (1 = primary); returns the new order. */
  reorderImage(
    id: string,
    imageId: string,
    position: number,
    signal?: AbortSignal,
  ): Promise<ProductImageInfo[]>;
  /** Authenticated-endpoint URL of the primary image (`thumb` = 96px rendition). */
  imageUrl(product: Pick<ProductSummary, 'id' | 'imageVersion'>, size?: ProductImageSize): string;
  /** URL of one specific picture (the dialog strip / detail gallery). */
  productImageUrl(
    productId: string,
    image: Pick<ProductImageInfo, 'id' | 'version'>,
    size?: ProductImageSize,
  ): string;
}

const ProductContext = createContext<ProductContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    errorCode?: string;
  };
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  const err = new Error(msg || fallback) as ProductApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  err.status = res.status;
  throw err;
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();

  const authHeaders = useCallback(
    (json = true): HeadersInit => {
      const token = getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return json
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
        : { Authorization: `Bearer ${token}` };
    },
    [getAccessToken],
  );

  const fetchProducts = useCallback(
    async (params?: ListProductsParams, signal?: AbortSignal): Promise<ProductListResponse> => {
      const res = await fetch(`${API_BASE}/products${buildQuery({ ...params })}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to load products');
      return (await res.json()) as ProductListResponse;
    },
    [authHeaders],
  );

  const getProduct = useCallback(
    async (id: string, signal?: AbortSignal): Promise<ProductSummary> => {
      const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to load product');
      return (await res.json()) as ProductSummary;
    },
    [authHeaders],
  );

  const fetchPurchases = useCallback(
    async (id: string, signal?: AbortSignal): Promise<ProductPurchasesResponse> => {
      const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/purchases`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to load purchases');
      return (await res.json()) as ProductPurchasesResponse;
    },
    [authHeaders],
  );

  const createProduct = useCallback(
    async (input: CreateProductInput, signal?: AbortSignal): Promise<ProductSummary> => {
      const res = await fetch(`${API_BASE}/products`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to create product');
      return (await res.json()) as ProductSummary;
    },
    [authHeaders],
  );

  const updateProduct = useCallback(
    async (
      id: string,
      patch: UpdateProductInput,
      signal?: AbortSignal,
    ): Promise<ProductSummary> => {
      const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to update product');
      return (await res.json()) as ProductSummary;
    },
    [authHeaders],
  );

  const addAlias = useCallback(
    async (
      id: string,
      input: { name: string; locale?: string },
      signal?: AbortSignal,
    ): Promise<ProductSummary> => {
      const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/aliases`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to add alias');
      return (await res.json()) as ProductSummary;
    },
    [authHeaders],
  );

  const lookupBarcode = useCallback(
    async (code: string, signal?: AbortSignal): Promise<BarcodeLookupResponse> => {
      const res = await fetch(`${API_BASE}/products/barcode/${encodeURIComponent(code)}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to look up barcode');
      return (await res.json()) as BarcodeLookupResponse;
    },
    [authHeaders],
  );

  const uploadImage = useCallback(
    async (id: string, file: File, signal?: AbortSignal): Promise<ProductImageInfo> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/images`, {
        method: 'POST',
        // No Content-Type — the browser sets the multipart boundary.
        headers: authHeaders(false),
        body: form,
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to upload image');
      return (await res.json()) as ProductImageInfo;
    },
    [authHeaders],
  );

  const removeImage = useCallback(
    async (id: string, imageId: string, signal?: AbortSignal): Promise<void> => {
      const res = await fetch(
        `${API_BASE}/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
        { method: 'DELETE', headers: authHeaders(), signal },
      );
      if (!res.ok) await throwApiError(res, 'Failed to remove image');
    },
    [authHeaders],
  );

  const reorderImage = useCallback(
    async (
      id: string,
      imageId: string,
      position: number,
      signal?: AbortSignal,
    ): Promise<ProductImageInfo[]> => {
      const res = await fetch(
        `${API_BASE}/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
        {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({ position }),
          signal,
        },
      );
      if (!res.ok) await throwApiError(res, 'Failed to reorder image');
      return (await res.json()) as ProductImageInfo[];
    },
    [authHeaders],
  );

  const imageUrl = useCallback(
    (product: Pick<ProductSummary, 'id' | 'imageVersion'>, size?: ProductImageSize): string => {
      const params = new URLSearchParams();
      if (size && size !== 'full') params.set('size', size);
      if (product.imageVersion) params.set('v', product.imageVersion);
      const query = params.toString();
      return (
        `${API_BASE}/products/${encodeURIComponent(product.id)}/image` + (query ? `?${query}` : '')
      );
    },
    [],
  );

  const productImageUrl = useCallback(
    (
      productId: string,
      image: Pick<ProductImageInfo, 'id' | 'version'>,
      size?: ProductImageSize,
    ): string => {
      const params = new URLSearchParams();
      if (size && size !== 'full') params.set('size', size);
      params.set('v', image.version);
      return (
        `${API_BASE}/products/${encodeURIComponent(productId)}/images/` +
        `${encodeURIComponent(image.id)}?${params.toString()}`
      );
    },
    [],
  );

  const value = useMemo<ProductContextValue>(
    () => ({
      fetchProducts,
      getProduct,
      fetchPurchases,
      createProduct,
      updateProduct,
      addAlias,
      lookupBarcode,
      uploadImage,
      removeImage,
      reorderImage,
      imageUrl,
      productImageUrl,
    }),
    [
      fetchProducts,
      getProduct,
      fetchPurchases,
      createProduct,
      updateProduct,
      addAlias,
      lookupBarcode,
      uploadImage,
      removeImage,
      reorderImage,
      imageUrl,
      productImageUrl,
    ],
  );

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useProducts(): ProductContextValue {
  const ctx = useContext(ProductContext);
  if (!ctx) throw new Error('useProducts must be used within a ProductProvider');
  return ctx;
}
