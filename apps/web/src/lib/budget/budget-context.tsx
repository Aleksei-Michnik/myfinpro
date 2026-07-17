'use client';

// Phase 10 · Iteration 10.3 — BudgetProvider (the product/receipt-context
// conventions: every method takes an optional AbortSignal, errors are rich
// ApiError-shaped objects carrying the API's `errorCode`).

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type {
  BudgetListResponse,
  BudgetSummary,
  CreateBudgetInput,
  ListBudgetsParams,
  UpdateBudgetInput,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';

export interface BudgetApiError extends Error {
  errorCode?: string;
  status?: number;
}

interface BudgetContextValue {
  fetchBudgets(params?: ListBudgetsParams, signal?: AbortSignal): Promise<BudgetListResponse>;
  getBudget(id: string, signal?: AbortSignal): Promise<BudgetSummary>;
  createBudget(input: CreateBudgetInput, signal?: AbortSignal): Promise<BudgetSummary>;
  updateBudget(id: string, patch: UpdateBudgetInput, signal?: AbortSignal): Promise<BudgetSummary>;
  deleteBudget(id: string, signal?: AbortSignal): Promise<void>;
  archiveBudget(id: string, signal?: AbortSignal): Promise<BudgetSummary>;
  unarchiveBudget(id: string, signal?: AbortSignal): Promise<BudgetSummary>;
}

const BudgetContext = createContext<BudgetContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') sp.append(k, v ? 'true' : 'false');
    else sp.append(k, String(v));
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
  const err = new Error(msg || fallback) as BudgetApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  err.status = res.status;
  throw err;
}

export function BudgetProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();

  const authHeaders = useCallback((): HeadersInit => {
    const token = getAccessToken();
    if (!token) throw new Error('Not authenticated');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }, [getAccessToken]);

  const fetchBudgets = useCallback(
    async (params?: ListBudgetsParams, signal?: AbortSignal): Promise<BudgetListResponse> => {
      const res = await fetch(`${API_BASE}/budgets${buildQuery({ ...params })}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to load budgets');
      return (await res.json()) as BudgetListResponse;
    },
    [authHeaders],
  );

  const getBudget = useCallback(
    async (id: string, signal?: AbortSignal): Promise<BudgetSummary> => {
      const res = await fetch(`${API_BASE}/budgets/${encodeURIComponent(id)}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to load budget');
      return (await res.json()) as BudgetSummary;
    },
    [authHeaders],
  );

  const createBudget = useCallback(
    async (input: CreateBudgetInput, signal?: AbortSignal): Promise<BudgetSummary> => {
      const res = await fetch(`${API_BASE}/budgets`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to create budget');
      return (await res.json()) as BudgetSummary;
    },
    [authHeaders],
  );

  const updateBudget = useCallback(
    async (id: string, patch: UpdateBudgetInput, signal?: AbortSignal): Promise<BudgetSummary> => {
      const res = await fetch(`${API_BASE}/budgets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to update budget');
      return (await res.json()) as BudgetSummary;
    },
    [authHeaders],
  );

  const deleteBudget = useCallback(
    async (id: string, signal?: AbortSignal): Promise<void> => {
      const res = await fetch(`${API_BASE}/budgets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to delete budget');
      // 204 → nothing to read.
    },
    [authHeaders],
  );

  // Archive / unarchive share the POST /budgets/:id/<action> shape.
  const archiveAction = useCallback(
    async (
      id: string,
      action: 'archive' | 'unarchive',
      signal?: AbortSignal,
    ): Promise<BudgetSummary> => {
      const res = await fetch(`${API_BASE}/budgets/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, `Failed to ${action} budget`);
      return (await res.json()) as BudgetSummary;
    },
    [authHeaders],
  );

  const archiveBudget = useCallback(
    (id: string, signal?: AbortSignal) => archiveAction(id, 'archive', signal),
    [archiveAction],
  );
  const unarchiveBudget = useCallback(
    (id: string, signal?: AbortSignal) => archiveAction(id, 'unarchive', signal),
    [archiveAction],
  );

  const value = useMemo<BudgetContextValue>(
    () => ({
      fetchBudgets,
      getBudget,
      createBudget,
      updateBudget,
      deleteBudget,
      archiveBudget,
      unarchiveBudget,
    }),
    [
      fetchBudgets,
      getBudget,
      createBudget,
      updateBudget,
      deleteBudget,
      archiveBudget,
      unarchiveBudget,
    ],
  );

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudgets(): BudgetContextValue {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error('useBudgets must be used within a BudgetProvider');
  return ctx;
}
