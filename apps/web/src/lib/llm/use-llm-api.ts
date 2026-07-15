'use client';

// Phase 8.11 — authorized fetchers for the LLM settings endpoints (the
// receipt/product-context conventions: optional AbortSignal, ApiError-shaped
// failures). A hook rather than a provider on purpose: this surface exists
// on a single settings page, so there is no cross-page cache to share.

import { useCallback, useMemo } from 'react';
import type { LlmCatalogResponse, LlmCredentialHint, LlmSelection } from './types';
import { useAuth } from '@/lib/auth/auth-context';

export interface LlmApiError extends Error {
  errorCode?: string;
  status?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    errorCode?: string;
  };
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  const err = new Error(msg || fallback) as LlmApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  err.status = res.status;
  throw err;
}

export interface LlmApi {
  fetchCatalog(signal?: AbortSignal): Promise<LlmCatalogResponse>;
  /** Both nulls revert to the deployment default. */
  updateSelection(
    provider: string | null,
    model: string | null,
    signal?: AbortSignal,
  ): Promise<LlmSelection | null>;
  setCredential(provider: string, apiKey: string, signal?: AbortSignal): Promise<LlmCredentialHint>;
  deleteCredential(provider: string, signal?: AbortSignal): Promise<void>;
}

export function useLlmApi(): LlmApi {
  const { getAccessToken } = useAuth();

  const authHeaders = useCallback((): HeadersInit => {
    const token = getAccessToken();
    if (!token) throw new Error('Not authenticated');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }, [getAccessToken]);

  const fetchCatalog = useCallback(
    async (signal?: AbortSignal): Promise<LlmCatalogResponse> => {
      const res = await fetch(`${API_BASE}/llm/catalog`, { headers: authHeaders(), signal });
      if (!res.ok) await throwApiError(res, 'Failed to load AI settings');
      return (await res.json()) as LlmCatalogResponse;
    },
    [authHeaders],
  );

  const updateSelection = useCallback(
    async (
      provider: string | null,
      model: string | null,
      signal?: AbortSignal,
    ): Promise<LlmSelection | null> => {
      const res = await fetch(`${API_BASE}/llm/selection`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ provider, model }),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to save AI model');
      return ((await res.json()) as { selection: LlmSelection | null }).selection;
    },
    [authHeaders],
  );

  const setCredential = useCallback(
    async (provider: string, apiKey: string, signal?: AbortSignal): Promise<LlmCredentialHint> => {
      const res = await fetch(`${API_BASE}/llm/credentials/${encodeURIComponent(provider)}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ apiKey }),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to save API key');
      return ((await res.json()) as { credential: LlmCredentialHint }).credential;
    },
    [authHeaders],
  );

  const deleteCredential = useCallback(
    async (provider: string, signal?: AbortSignal): Promise<void> => {
      const res = await fetch(`${API_BASE}/llm/credentials/${encodeURIComponent(provider)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to remove API key');
    },
    [authHeaders],
  );

  return useMemo(
    () => ({ fetchCatalog, updateSelection, setCredential, deleteCredential }),
    [fetchCatalog, updateSelection, setCredential, deleteCredential],
  );
}
