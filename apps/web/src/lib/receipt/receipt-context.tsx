'use client';

// Phase 7 · Iteration 7.7 — ReceiptProvider (the transaction-context conventions:
// every method takes an optional AbortSignal, errors are rich TransactionApiError-
// shaped objects, run() maintains the transient loading/error state).

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  ConfirmReceiptInput,
  ListReceiptsParams,
  ManualReceiptInput,
  MerchantSuggestion,
  ReceiptItemInput,
  ReceiptListResponse,
  ReceiptSummary,
  UpdateReceiptInput,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';
import type { MatchItemInput } from '@/lib/product/types';

export interface ReceiptApiError extends Error {
  errorCode?: string;
  status?: number;
}

interface ReceiptContextValue {
  /** Multipart upload — several images are the pages of ONE receipt (8.22). */
  uploadReceipt(files: File[], signal?: AbortSignal): Promise<ReceiptSummary>;
  /** Ingest an online receipt by URL. */
  createFromUrl(url: string, signal?: AbortSignal): Promise<ReceiptSummary>;
  /** Compose a receipt from scanned products — born in REVIEW (8.14). */
  createManual(input: ManualReceiptInput, signal?: AbortSignal): Promise<ReceiptSummary>;
  /** Attach a receipt (photo pages) to an existing transaction — born linked (8.15). */
  attachFileToTransaction(
    transactionId: string,
    files: File[],
    signal?: AbortSignal,
  ): Promise<ReceiptSummary>;
  /** Attach an online receipt by URL to an existing transaction (8.15). */
  attachUrlToTransaction(
    transactionId: string,
    url: string,
    signal?: AbortSignal,
  ): Promise<ReceiptSummary>;
  /** Finish an attached receipt: REVIEW → CONFIRMED, apply chosen fields (8.15). */
  reconcileReceipt(
    id: string,
    input: { applyTotal: boolean; applyCategory: boolean },
    signal?: AbortSignal,
  ): Promise<ReceiptSummary>;
  fetchList(params?: ListReceiptsParams, signal?: AbortSignal): Promise<ReceiptListResponse>;
  getReceipt(id: string, signal?: AbortSignal): Promise<ReceiptSummary>;
  /** FAILED → back through the extraction pipeline. */
  retryReceipt(id: string, signal?: AbortSignal): Promise<ReceiptSummary>;
  /** Non-confirmed receipts only. */
  removeReceipt(id: string, signal?: AbortSignal): Promise<void>;
  /** REVIEW-only header corrections (7.8). */
  updateReceipt(
    id: string,
    patch: UpdateReceiptInput,
    signal?: AbortSignal,
  ): Promise<ReceiptSummary>;
  /** REVIEW-only full item replacement (7.8). */
  replaceItems(
    id: string,
    items: ReceiptItemInput[],
    signal?: AbortSignal,
  ): Promise<ReceiptSummary>;
  /** Global merchant registry lookup (7.8). */
  searchMerchants(search: string, signal?: AbortSignal): Promise<MerchantSuggestion[]>;
  /** Walkthrough confirm — link/create a registry product for one item (8.4). */
  matchItem(
    receiptId: string,
    itemId: string,
    input: MatchItemInput,
    signal?: AbortSignal,
  ): Promise<ReceiptSummary>;
  /** Walkthrough skip/unlink — always resumable (8.4). */
  skipItemMatch(receiptId: string, itemId: string, signal?: AbortSignal): Promise<ReceiptSummary>;
  /** REVIEW → CONFIRMED: create the transaction from the reviewed receipt (7.9). */
  confirmReceipt(
    id: string,
    input: ConfirmReceiptInput,
    signal?: AbortSignal,
  ): Promise<ReceiptSummary>;
  /** Authenticated fetch of the stored file as a Blob (for previews). */
  fetchFileBlob(id: string, fileId: string, signal?: AbortSignal): Promise<Blob>;
  /** Authenticated-endpoint URL of the stored file (for <img>/<object>). */
  fileUrl(id: string, fileId: string): string;

  isLoading: boolean;
  error: string | null;
  clearError(): void;
}

const ReceiptContext = createContext<ReceiptContextValue | null>(null);

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
  const err = new Error(msg || fallback) as ReceiptApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  err.status = res.status;
  throw err;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (!!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError')
  );
}

export function ReceiptProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof Error && err.message ? err.message : 'Unexpected error');
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadReceipt = useCallback(
    (files: File[], signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const form = new FormData();
        for (const file of files) form.append('files', file);
        const res = await fetch(`${API_BASE}/receipts`, {
          method: 'POST',
          // No Content-Type — the browser sets the multipart boundary.
          headers: authHeaders(false),
          body: form,
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to upload receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const createFromUrl = useCallback(
    (url: string, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/url`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ url }),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to add receipt URL');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const createManual = useCallback(
    (input: ManualReceiptInput, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/manual`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to create receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const attachFileToTransaction = useCallback(
    (transactionId: string, files: File[], signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const form = new FormData();
        for (const file of files) form.append('files', file);
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/receipt`,
          {
            method: 'POST',
            headers: authHeaders(false),
            body: form,
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, 'Failed to attach receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const attachUrlToTransaction = useCallback(
    (transactionId: string, url: string, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/receipt-url`,
          { method: 'POST', headers: authHeaders(), body: JSON.stringify({ url }), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to attach receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const reconcileReceipt = useCallback(
    (
      id: string,
      input: { applyTotal: boolean; applyCategory: boolean },
      signal?: AbortSignal,
    ): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/${encodeURIComponent(id)}/reconcile`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to reconcile receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const fetchList = useCallback(
    (params?: ListReceiptsParams, signal?: AbortSignal): Promise<ReceiptListResponse> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts${buildQuery({ ...params })}`, {
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to load receipts');
        return (await res.json()) as ReceiptListResponse;
      }),
    [authHeaders, run],
  );

  const getReceipt = useCallback(
    (id: string, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/${encodeURIComponent(id)}`, {
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to load receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const retryReceipt = useCallback(
    (id: string, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/${encodeURIComponent(id)}/retry`, {
          method: 'POST',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to retry extraction');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const removeReceipt = useCallback(
    (id: string, signal?: AbortSignal): Promise<void> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to delete receipt');
      }),
    [authHeaders, run],
  );

  const fileUrl = useCallback(
    (id: string, fileId: string): string =>
      `${API_BASE}/receipts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
    [],
  );

  const updateReceipt = useCallback(
    (id: string, patch: UpdateReceiptInput, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify(patch),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to update receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const replaceItems = useCallback(
    (id: string, items: ReceiptItemInput[], signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/${encodeURIComponent(id)}/items`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ items }),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to update items');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const searchMerchants = useCallback(
    (search: string, signal?: AbortSignal): Promise<MerchantSuggestion[]> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/merchants${buildQuery({ search })}`, {
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to search merchants');
        return (await res.json()) as MerchantSuggestion[];
      }),
    [authHeaders, run],
  );

  const matchItem = useCallback(
    (
      receiptId: string,
      itemId: string,
      input: MatchItemInput,
      signal?: AbortSignal,
    ): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(itemId)}/match`,
          { method: 'POST', headers: authHeaders(), body: JSON.stringify(input), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to match item');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const skipItemMatch = useCallback(
    (receiptId: string, itemId: string, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(itemId)}/skip-match`,
          { method: 'POST', headers: authHeaders(), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to skip item');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const fetchFileBlob = useCallback(
    (id: string, fileId: string, signal?: AbortSignal): Promise<Blob> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/receipts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
          { headers: authHeaders(false), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to load receipt file');
        return res.blob();
      }),
    [authHeaders, run],
  );

  const confirmReceipt = useCallback(
    (id: string, input: ConfirmReceiptInput, signal?: AbortSignal): Promise<ReceiptSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/receipts/${encodeURIComponent(id)}/confirm`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to confirm receipt');
        return (await res.json()) as ReceiptSummary;
      }),
    [authHeaders, run],
  );

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<ReceiptContextValue>(
    () => ({
      uploadReceipt,
      createFromUrl,
      createManual,
      attachFileToTransaction,
      attachUrlToTransaction,
      reconcileReceipt,
      fetchList,
      getReceipt,
      retryReceipt,
      removeReceipt,
      updateReceipt,
      replaceItems,
      searchMerchants,
      matchItem,
      skipItemMatch,
      fetchFileBlob,
      confirmReceipt,
      fileUrl,
      isLoading,
      error,
      clearError,
    }),
    [
      uploadReceipt,
      createFromUrl,
      createManual,
      attachFileToTransaction,
      attachUrlToTransaction,
      reconcileReceipt,
      fetchList,
      getReceipt,
      retryReceipt,
      removeReceipt,
      updateReceipt,
      replaceItems,
      searchMerchants,
      matchItem,
      skipItemMatch,
      fetchFileBlob,
      confirmReceipt,
      fileUrl,
      isLoading,
      error,
      clearError,
    ],
  );

  return <ReceiptContext.Provider value={value}>{children}</ReceiptContext.Provider>;
}

export function useReceipts(): ReceiptContextValue {
  const ctx = useContext(ReceiptContext);
  if (!ctx) throw new Error('useReceipts must be used within a ReceiptProvider');
  return ctx;
}
