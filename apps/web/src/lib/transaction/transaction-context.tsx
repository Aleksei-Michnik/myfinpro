'use client';

// Phase 6 · Iteration 6.11 — TransactionProvider.
// Phase 6 · Iteration 6.16.2 — every public method now accepts an optional
// `AbortSignal` so callers wired through `useAsyncOperation()` can cancel
// in-flight requests on filter change, retry, or component unmount. The
// signal is forwarded to the underlying `fetch` call.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  AttributionChangeResult,
  CascadeEditResult,
  CategoryDto,
  Comment,
  CommentListResponse,
  CreateTransactionInput,
  ListCategoriesParams,
  ListCommentsParams,
  ListOccurrencesParams,
  ListTransactionsParams,
  TransactionListResponse,
  TransactionPropagateMode,
  TransactionSummary,
  PlanResponse,
  ScheduleResponse,
  ScheduleSpec,
  ToggleStarResult,
  UpdateTransactionInput,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';

export interface TransactionApiError extends Error {
  errorCode?: string;
  status?: number;
}

interface TransactionContextValue {
  // Transactions
  fetchList(
    params?: ListTransactionsParams,
    signal?: AbortSignal,
  ): Promise<TransactionListResponse>;
  getTransaction(id: string, signal?: AbortSignal): Promise<TransactionSummary>;
  createTransaction(
    input: CreateTransactionInput,
    signal?: AbortSignal,
  ): Promise<TransactionSummary>;
  /** Returns null when the API responds 204 — signals transaction hard-deletion. */
  updateTransaction(
    id: string,
    input: UpdateTransactionInput,
    signal?: AbortSignal,
  ): Promise<TransactionSummary | null>;
  /**
   * Iteration 6.18.1.5 — edit a RECURRING parent's non-period fields and
   * cascade the deltas to its child occurrences per `propagate`. Returns the
   * cascade-edit envelope (updated parent + affected/skipped child counts).
   * For `self` the parent is edited with zero children touched.
   */
  editTransactionWithPropagation(
    id: string,
    input: UpdateTransactionInput,
    propagate: TransactionPropagateMode,
    signal?: AbortSignal,
  ): Promise<CascadeEditResult>;
  removeTransaction(
    id: string,
    scope?: string,
    signal?: AbortSignal,
  ): Promise<AttributionChangeResult>;
  toggleStar(id: string, signal?: AbortSignal): Promise<ToggleStarResult>;

  /**
   * Iteration 6.18.1.3 — list child occurrences of a recurring parent.
   *
   * Thin wrapper over `GET /transactions/:transactionId/occurrences`. The response
   * shape is identical to the existing `fetchList` (cursor + hasMore). The
   * server enforces visibility on the parent and returns 404 if the caller
   * cannot see it (no existence leak).
   */
  listOccurrences(
    parentTransactionId: string,
    query?: ListOccurrencesParams,
    signal?: AbortSignal,
  ): Promise<TransactionListResponse>;

  // Comments
  listComments(
    transactionId: string,
    opts?: ListCommentsParams,
    signal?: AbortSignal,
  ): Promise<CommentListResponse>;
  postComment(transactionId: string, content: string, signal?: AbortSignal): Promise<Comment>;
  editComment(
    transactionId: string,
    commentId: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<Comment>;
  deleteComment(transactionId: string, commentId: string, signal?: AbortSignal): Promise<void>;

  // Categories (read-only in 6.11; CRUD comes in 6.16)
  listCategories(query?: ListCategoriesParams, signal?: AbortSignal): Promise<CategoryDto[]>;

  // Schedules (Phase 6 · Iteration 6.18.1)
  /** Create the schedule attached to a RECURRING transaction. */
  createSchedule(
    transactionId: string,
    spec: ScheduleSpec,
    signal?: AbortSignal,
  ): Promise<ScheduleResponse>;
  /**
   * Read the schedule. The API responds 404 when the parent transaction has no
   * schedule attached — we translate that to `null` so the absence is not a
   * UI-level error.
   */
  getSchedule(transactionId: string, signal?: AbortSignal): Promise<ScheduleResponse | null>;
  /** Idempotent upsert of the schedule's spec. */
  replaceSchedule(
    transactionId: string,
    spec: ScheduleSpec,
    signal?: AbortSignal,
  ): Promise<ScheduleResponse>;
  /** Remove the schedule + its BullMQ scheduler entry. */
  removeSchedule(transactionId: string, signal?: AbortSignal): Promise<void>;

  // Schedule lifecycle (Phase 6 · Iteration 6.18.2). Creator-only on the
  // API side (404 for everyone else). `cancel` is terminal — the API
  // answers 409 for any transition out of the cancelled state.
  pauseSchedule(transactionId: string, signal?: AbortSignal): Promise<ScheduleResponse>;
  resumeSchedule(transactionId: string, signal?: AbortSignal): Promise<ScheduleResponse>;
  cancelSchedule(transactionId: string, signal?: AbortSignal): Promise<ScheduleResponse>;

  // Plans (Phase 6 · Iteration 6.20). Creation is inline on createTransaction
  // (plan body); these cover the detail-page read + terminal cancel.
  /** 404 (no plan) is translated to `null` so absence is not a UI error. */
  getPlan(transactionId: string, signal?: AbortSignal): Promise<PlanResponse | null>;
  cancelPlan(transactionId: string, signal?: AbortSignal): Promise<PlanResponse>;

  // Transient state
  isLoading: boolean;
  error: string | null;
  clearError(): void;
}

const TransactionContext = createContext<TransactionContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

/** Build a URLSearchParams string from a plain params object; omits undefined/null. */
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

/** Parse a failed Response into a rich `TransactionApiError`. */
async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    errorCode?: string;
  };
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  const err = new Error(msg || fallback) as TransactionApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  err.status = res.status;
  throw err;
}

/** Normalise any thrown value to a human-readable message for `error` state. */
function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

/** Aborts are user-initiated and shouldn't surface as a top-level error. */
function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'AbortError'
  ) {
    return true;
  }
  return false;
}

export function TransactionProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback((): HeadersInit => {
    const token = getAccessToken();
    if (!token) throw new Error('Not authenticated');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, [getAccessToken]);

  /** Wrap an async block with the loading + error state + bubble-up throw. */
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      // Aborts are silent — they're user-initiated cancellations from
      // useAsyncOperation. Re-throw so callers can react, but don't surface
      // the abort as a context-level error message.
      if (!isAbortError(e)) {
        setError(extractMessage(e));
      }
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Transactions ───────────────────────────────────────────────────────────

  const fetchList = useCallback(
    (params?: ListTransactionsParams, signal?: AbortSignal): Promise<TransactionListResponse> =>
      run(async () => {
        const qs = buildQuery(params as Record<string, unknown> | undefined);
        const res = await fetch(`${API_BASE}/transactions${qs}`, {
          method: 'GET',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to load transactions');
        return (await res.json()) as TransactionListResponse;
      }),
    [authHeaders, run],
  );

  const getTransaction = useCallback(
    (id: string, signal?: AbortSignal): Promise<TransactionSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to load transaction');
        return (await res.json()) as TransactionSummary;
      }),
    [authHeaders, run],
  );

  const createTransaction = useCallback(
    (input: CreateTransactionInput, signal?: AbortSignal): Promise<TransactionSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/transactions`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to create transaction');
        return (await res.json()) as TransactionSummary;
      }),
    [authHeaders, run],
  );

  const updateTransaction = useCallback(
    (
      id: string,
      input: UpdateTransactionInput,
      signal?: AbortSignal,
    ): Promise<TransactionSummary | null> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to update transaction');
        // 204 No Content → transaction was hard-deleted by the attribution change.
        if (res.status === 204) return null;
        return (await res.json()) as TransactionSummary;
      }),
    [authHeaders, run],
  );

  const editTransactionWithPropagation = useCallback(
    (
      id: string,
      input: UpdateTransactionInput,
      propagate: TransactionPropagateMode,
      signal?: AbortSignal,
    ): Promise<CascadeEditResult> =>
      run(async () => {
        const qs = buildQuery({ propagate });
        const res = await fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}${qs}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to update transaction');
        return (await res.json()) as CascadeEditResult;
      }),
    [authHeaders, run],
  );

  const removeTransaction = useCallback(
    (id: string, scope?: string, signal?: AbortSignal): Promise<AttributionChangeResult> =>
      run(async () => {
        const qs = scope ? `?scope=${encodeURIComponent(scope)}` : '';
        const res = await fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}${qs}`, {
          method: 'DELETE',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to delete transaction');
        return (await res.json()) as AttributionChangeResult;
      }),
    [authHeaders, run],
  );

  const toggleStar = useCallback(
    (id: string, signal?: AbortSignal): Promise<ToggleStarResult> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}/star`, {
          method: 'POST',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to toggle star');
        return (await res.json()) as ToggleStarResult;
      }),
    [authHeaders, run],
  );

  const listOccurrences = useCallback(
    (
      parentTransactionId: string,
      query?: ListOccurrencesParams,
      signal?: AbortSignal,
    ): Promise<TransactionListResponse> =>
      run(async () => {
        const qs = buildQuery(query as Record<string, unknown> | undefined);
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(parentTransactionId)}/occurrences${qs}`,
          { method: 'GET', headers: authHeaders(), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to load occurrences');
        return (await res.json()) as TransactionListResponse;
      }),
    [authHeaders, run],
  );

  // ── Comments ───────────────────────────────────────────────────────────

  const listComments = useCallback(
    (
      transactionId: string,
      opts?: ListCommentsParams,
      signal?: AbortSignal,
    ): Promise<CommentListResponse> =>
      run(async () => {
        const qs = buildQuery(opts as Record<string, unknown> | undefined);
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/comments${qs}`,
          { method: 'GET', headers: authHeaders(), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to load comments');
        return (await res.json()) as CommentListResponse;
      }),
    [authHeaders, run],
  );

  const postComment = useCallback(
    (transactionId: string, content: string, signal?: AbortSignal): Promise<Comment> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/comments`,
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ content }),
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, 'Failed to post comment');
        return (await res.json()) as Comment;
      }),
    [authHeaders, run],
  );

  const editComment = useCallback(
    (
      transactionId: string,
      commentId: string,
      content: string,
      signal?: AbortSignal,
    ): Promise<Comment> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/comments/${encodeURIComponent(commentId)}`,
          {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ content }),
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, 'Failed to edit comment');
        return (await res.json()) as Comment;
      }),
    [authHeaders, run],
  );

  const deleteComment = useCallback(
    (transactionId: string, commentId: string, signal?: AbortSignal): Promise<void> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/comments/${encodeURIComponent(commentId)}`,
          { method: 'DELETE', headers: authHeaders(), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to delete comment');
        // 204 → nothing to read.
      }),
    [authHeaders, run],
  );

  // ── Categories (read-only in 6.11) ─────────────────────────────────────

  const listCategories = useCallback(
    (query?: ListCategoriesParams, signal?: AbortSignal): Promise<CategoryDto[]> =>
      run(async () => {
        const qs = buildQuery(query as Record<string, unknown> | undefined);
        const res = await fetch(`${API_BASE}/categories${qs}`, {
          method: 'GET',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to load categories');
        return (await res.json()) as CategoryDto[];
      }),
    [authHeaders, run],
  );

  // ── Schedules (Phase 6 · Iteration 6.18.1) ─────────────────────────────

  const createSchedule = useCallback(
    (transactionId: string, spec: ScheduleSpec, signal?: AbortSignal): Promise<ScheduleResponse> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/schedule`,
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(spec),
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, 'Failed to create schedule');
        return (await res.json()) as ScheduleResponse;
      }),
    [authHeaders, run],
  );

  const getSchedule = useCallback(
    (transactionId: string, signal?: AbortSignal): Promise<ScheduleResponse | null> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/schedule`,
          {
            method: 'GET',
            headers: authHeaders(),
            signal,
          },
        );
        if (res.status === 404) return null;
        if (!res.ok) await throwApiError(res, 'Failed to load schedule');
        return (await res.json()) as ScheduleResponse;
      }),
    [authHeaders, run],
  );

  const replaceSchedule = useCallback(
    (transactionId: string, spec: ScheduleSpec, signal?: AbortSignal): Promise<ScheduleResponse> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/schedule`,
          {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify(spec),
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, 'Failed to update schedule');
        return (await res.json()) as ScheduleResponse;
      }),
    [authHeaders, run],
  );

  const removeSchedule = useCallback(
    (transactionId: string, signal?: AbortSignal): Promise<void> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/schedule`,
          {
            method: 'DELETE',
            headers: authHeaders(),
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, 'Failed to delete schedule');
        // 204 → nothing to read.
      }),
    [authHeaders, run],
  );

  // ── Schedule lifecycle (Phase 6 · Iteration 6.18.2) ────────────────────
  // All three share the same POST /transactions/:id/schedule/<action> shape and
  // return the updated ScheduleResponse, so they funnel through one helper.
  const scheduleLifecycle = useCallback(
    (
      transactionId: string,
      action: 'pause' | 'resume' | 'cancel',
      signal?: AbortSignal,
    ): Promise<ScheduleResponse> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/schedule/${action}`,
          {
            method: 'POST',
            headers: authHeaders(),
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, `Failed to ${action} schedule`);
        return (await res.json()) as ScheduleResponse;
      }),
    [authHeaders, run],
  );

  const pauseSchedule = useCallback(
    (transactionId: string, signal?: AbortSignal) =>
      scheduleLifecycle(transactionId, 'pause', signal),
    [scheduleLifecycle],
  );
  const resumeSchedule = useCallback(
    (transactionId: string, signal?: AbortSignal) =>
      scheduleLifecycle(transactionId, 'resume', signal),
    [scheduleLifecycle],
  );
  const cancelSchedule = useCallback(
    (transactionId: string, signal?: AbortSignal) =>
      scheduleLifecycle(transactionId, 'cancel', signal),
    [scheduleLifecycle],
  );

  // ── Plans (Phase 6 · Iteration 6.20) ────────────────────────────────────

  const getPlan = useCallback(
    (transactionId: string, signal?: AbortSignal): Promise<PlanResponse | null> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/plan`,
          {
            headers: authHeaders(),
            signal,
          },
        );
        if (res.status === 404) return null;
        if (!res.ok) await throwApiError(res, 'Failed to load plan');
        return (await res.json()) as PlanResponse;
      }),
    [authHeaders, run],
  );

  const cancelPlan = useCallback(
    (transactionId: string, signal?: AbortSignal): Promise<PlanResponse> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/transactions/${encodeURIComponent(transactionId)}/plan`,
          {
            method: 'DELETE',
            headers: authHeaders(),
            signal,
          },
        );
        if (!res.ok) await throwApiError(res, 'Failed to cancel plan');
        return (await res.json()) as PlanResponse;
      }),
    [authHeaders, run],
  );

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<TransactionContextValue>(
    () => ({
      fetchList,
      getTransaction,
      createTransaction,
      updateTransaction,
      editTransactionWithPropagation,
      removeTransaction,
      toggleStar,
      listOccurrences,
      listComments,
      postComment,
      editComment,
      deleteComment,
      listCategories,
      createSchedule,
      getSchedule,
      replaceSchedule,
      removeSchedule,
      pauseSchedule,
      resumeSchedule,
      cancelSchedule,
      getPlan,
      cancelPlan,
      isLoading,
      error,
      clearError,
    }),
    [
      fetchList,
      getTransaction,
      createTransaction,
      updateTransaction,
      editTransactionWithPropagation,
      removeTransaction,
      toggleStar,
      listOccurrences,
      listComments,
      postComment,
      editComment,
      deleteComment,
      listCategories,
      createSchedule,
      getSchedule,
      replaceSchedule,
      removeSchedule,
      pauseSchedule,
      resumeSchedule,
      cancelSchedule,
      getPlan,
      cancelPlan,
      isLoading,
      error,
      clearError,
    ],
  );

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
}

export function useTransactions(): TransactionContextValue {
  const ctx = useContext(TransactionContext);
  if (!ctx) {
    throw new Error('useTransactions must be used within a TransactionProvider');
  }
  return ctx;
}
