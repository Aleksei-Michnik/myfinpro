'use client';

// Phase 20 · Iteration 20.7 — authorized fetchers for the connector-token
// endpoints (docs/ui/20.7-connector-tokens.md §0). The `useLlmApi` shape: a
// hook rather than a provider (one settings surface, no cross-page cache),
// `ApiError`-shaped failures (`errorCode` + `status` on the thrown `Error`,
// read by `useAsyncOperation`'s `classifyError` via `.status`), an
// `AbortSignal` on every call.

import { useCallback, useMemo } from 'react';
import {
  API_TOKEN_SCOPE_ACCOUNTS_IMPORT,
  type ApiTokenCreated,
  type ApiTokenSummary,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';

export interface ApiTokenApiError extends Error {
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
  const err = new Error(msg || fallback) as ApiTokenApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  err.status = res.status;
  throw err;
}

export interface CreateApiTokenInput {
  name: string;
  /** Omit for "never expires". */
  expiresAt?: string;
}

export interface ApiTokensApi {
  listTokens(signal?: AbortSignal): Promise<ApiTokenSummary[]>;
  createToken(input: CreateApiTokenInput, signal?: AbortSignal): Promise<ApiTokenCreated>;
  revokeToken(id: string, signal?: AbortSignal): Promise<void>;
}

export function useApiTokens(): ApiTokensApi {
  const { getAccessToken } = useAuth();

  const authHeaders = useCallback((): HeadersInit => {
    const token = getAccessToken();
    if (!token) throw new Error('Not authenticated');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }, [getAccessToken]);

  const listTokens = useCallback(
    async (signal?: AbortSignal): Promise<ApiTokenSummary[]> => {
      const res = await fetch(`${API_BASE}/auth/tokens`, { headers: authHeaders(), signal });
      if (!res.ok) await throwApiError(res, 'Failed to load tokens');
      const body = (await res.json()) as ApiTokenSummary[] | { data: ApiTokenSummary[] };
      // Tolerant of either a bare array or a `{ data: [...] }` envelope.
      return Array.isArray(body) ? body : body.data;
    },
    [authHeaders],
  );

  const createToken = useCallback(
    async (input: CreateApiTokenInput, signal?: AbortSignal): Promise<ApiTokenCreated> => {
      const res = await fetch(`${API_BASE}/auth/tokens`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: input.name,
          scopes: [API_TOKEN_SCOPE_ACCOUNTS_IMPORT],
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        }),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to create token');
      return (await res.json()) as ApiTokenCreated;
    },
    [authHeaders],
  );

  const revokeToken = useCallback(
    async (id: string, signal?: AbortSignal): Promise<void> => {
      const res = await fetch(`${API_BASE}/auth/tokens/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to revoke token');
    },
    [authHeaders],
  );

  return useMemo(
    () => ({ listTokens, createToken, revokeToken }),
    [listTokens, createToken, revokeToken],
  );
}
