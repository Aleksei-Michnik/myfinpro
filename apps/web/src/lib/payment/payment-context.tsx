'use client';

// Phase 6 · Iteration 6.11 — PaymentProvider.
// Phase 6 · Iteration 6.16.2 — every public method now accepts an optional
// `AbortSignal` so callers wired through `useAsyncOperation()` can cancel
// in-flight requests on filter change, retry, or component unmount. The
// signal is forwarded to the underlying `fetch` call.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  AttributionChangeResult,
  CategoryDto,
  Comment,
  CommentListResponse,
  CreatePaymentInput,
  ListCategoriesParams,
  ListCommentsParams,
  ListPaymentsParams,
  PaymentListResponse,
  PaymentSummary,
  ScheduleResponse,
  ScheduleSpec,
  ToggleStarResult,
  UpdatePaymentInput,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';

export interface PaymentApiError extends Error {
  errorCode?: string;
  status?: number;
}

interface PaymentContextValue {
  // Payments
  fetchList(params?: ListPaymentsParams, signal?: AbortSignal): Promise<PaymentListResponse>;
  getPayment(id: string, signal?: AbortSignal): Promise<PaymentSummary>;
  createPayment(input: CreatePaymentInput, signal?: AbortSignal): Promise<PaymentSummary>;
  /** Returns null when the API responds 204 — signals payment hard-deletion. */
  updatePayment(
    id: string,
    input: UpdatePaymentInput,
    signal?: AbortSignal,
  ): Promise<PaymentSummary | null>;
  removePayment(id: string, scope?: string, signal?: AbortSignal): Promise<AttributionChangeResult>;
  toggleStar(id: string, signal?: AbortSignal): Promise<ToggleStarResult>;

  // Comments
  listComments(
    paymentId: string,
    opts?: ListCommentsParams,
    signal?: AbortSignal,
  ): Promise<CommentListResponse>;
  postComment(paymentId: string, content: string, signal?: AbortSignal): Promise<Comment>;
  editComment(
    paymentId: string,
    commentId: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<Comment>;
  deleteComment(paymentId: string, commentId: string, signal?: AbortSignal): Promise<void>;

  // Categories (read-only in 6.11; CRUD comes in 6.16)
  listCategories(query?: ListCategoriesParams, signal?: AbortSignal): Promise<CategoryDto[]>;

  // Schedules (Phase 6 · Iteration 6.18.1)
  /**
   * Create the schedule attached to a RECURRING payment. Lifecycle endpoints
   * (pause / resume / cancel) ship in 6.18.2.
   */
  createSchedule(
    paymentId: string,
    spec: ScheduleSpec,
    signal?: AbortSignal,
  ): Promise<ScheduleResponse>;
  /**
   * Read the schedule. The API responds 404 when the parent payment has no
   * schedule attached — we translate that to `null` so the absence is not a
   * UI-level error.
   */
  getSchedule(paymentId: string, signal?: AbortSignal): Promise<ScheduleResponse | null>;
  /** Idempotent upsert of the schedule's spec. */
  replaceSchedule(
    paymentId: string,
    spec: ScheduleSpec,
    signal?: AbortSignal,
  ): Promise<ScheduleResponse>;
  /** Remove the schedule + its BullMQ scheduler entry. */
  removeSchedule(paymentId: string, signal?: AbortSignal): Promise<void>;

  // Transient state
  isLoading: boolean;
  error: string | null;
  clearError(): void;
}

const PaymentContext = createContext<PaymentContextValue | null>(null);

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

/** Parse a failed Response into a rich `PaymentApiError`. */
async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    errorCode?: string;
  };
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  const err = new Error(msg || fallback) as PaymentApiError;
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

export function PaymentProvider({ children }: { children: ReactNode }) {
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

  // ── Payments ───────────────────────────────────────────────────────────

  const fetchList = useCallback(
    (params?: ListPaymentsParams, signal?: AbortSignal): Promise<PaymentListResponse> =>
      run(async () => {
        const qs = buildQuery(params as Record<string, unknown> | undefined);
        const res = await fetch(`${API_BASE}/payments${qs}`, {
          method: 'GET',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to load payments');
        return (await res.json()) as PaymentListResponse;
      }),
    [authHeaders, run],
  );

  const getPayment = useCallback(
    (id: string, signal?: AbortSignal): Promise<PaymentSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to load payment');
        return (await res.json()) as PaymentSummary;
      }),
    [authHeaders, run],
  );

  const createPayment = useCallback(
    (input: CreatePaymentInput, signal?: AbortSignal): Promise<PaymentSummary> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to create payment');
        return (await res.json()) as PaymentSummary;
      }),
    [authHeaders, run],
  );

  const updatePayment = useCallback(
    (id: string, input: UpdatePaymentInput, signal?: AbortSignal): Promise<PaymentSummary | null> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to update payment');
        // 204 No Content → payment was hard-deleted by the attribution change.
        if (res.status === 204) return null;
        return (await res.json()) as PaymentSummary;
      }),
    [authHeaders, run],
  );

  const removePayment = useCallback(
    (id: string, scope?: string, signal?: AbortSignal): Promise<AttributionChangeResult> =>
      run(async () => {
        const qs = scope ? `?scope=${encodeURIComponent(scope)}` : '';
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(id)}${qs}`, {
          method: 'DELETE',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to delete payment');
        return (await res.json()) as AttributionChangeResult;
      }),
    [authHeaders, run],
  );

  const toggleStar = useCallback(
    (id: string, signal?: AbortSignal): Promise<ToggleStarResult> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(id)}/star`, {
          method: 'POST',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to toggle star');
        return (await res.json()) as ToggleStarResult;
      }),
    [authHeaders, run],
  );

  // ── Comments ───────────────────────────────────────────────────────────

  const listComments = useCallback(
    (
      paymentId: string,
      opts?: ListCommentsParams,
      signal?: AbortSignal,
    ): Promise<CommentListResponse> =>
      run(async () => {
        const qs = buildQuery(opts as Record<string, unknown> | undefined);
        const res = await fetch(
          `${API_BASE}/payments/${encodeURIComponent(paymentId)}/comments${qs}`,
          { method: 'GET', headers: authHeaders(), signal },
        );
        if (!res.ok) await throwApiError(res, 'Failed to load comments');
        return (await res.json()) as CommentListResponse;
      }),
    [authHeaders, run],
  );

  const postComment = useCallback(
    (paymentId: string, content: string, signal?: AbortSignal): Promise<Comment> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/comments`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ content }),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to post comment');
        return (await res.json()) as Comment;
      }),
    [authHeaders, run],
  );

  const editComment = useCallback(
    (
      paymentId: string,
      commentId: string,
      content: string,
      signal?: AbortSignal,
    ): Promise<Comment> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/payments/${encodeURIComponent(paymentId)}/comments/${encodeURIComponent(commentId)}`,
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
    (paymentId: string, commentId: string, signal?: AbortSignal): Promise<void> =>
      run(async () => {
        const res = await fetch(
          `${API_BASE}/payments/${encodeURIComponent(paymentId)}/comments/${encodeURIComponent(commentId)}`,
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
    (paymentId: string, spec: ScheduleSpec, signal?: AbortSignal): Promise<ScheduleResponse> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/schedule`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(spec),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to create schedule');
        return (await res.json()) as ScheduleResponse;
      }),
    [authHeaders, run],
  );

  const getSchedule = useCallback(
    (paymentId: string, signal?: AbortSignal): Promise<ScheduleResponse | null> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/schedule`, {
          method: 'GET',
          headers: authHeaders(),
          signal,
        });
        if (res.status === 404) return null;
        if (!res.ok) await throwApiError(res, 'Failed to load schedule');
        return (await res.json()) as ScheduleResponse;
      }),
    [authHeaders, run],
  );

  const replaceSchedule = useCallback(
    (paymentId: string, spec: ScheduleSpec, signal?: AbortSignal): Promise<ScheduleResponse> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/schedule`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(spec),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to update schedule');
        return (await res.json()) as ScheduleResponse;
      }),
    [authHeaders, run],
  );

  const removeSchedule = useCallback(
    (paymentId: string, signal?: AbortSignal): Promise<void> =>
      run(async () => {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/schedule`, {
          method: 'DELETE',
          headers: authHeaders(),
          signal,
        });
        if (!res.ok) await throwApiError(res, 'Failed to delete schedule');
        // 204 → nothing to read.
      }),
    [authHeaders, run],
  );

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<PaymentContextValue>(
    () => ({
      fetchList,
      getPayment,
      createPayment,
      updatePayment,
      removePayment,
      toggleStar,
      listComments,
      postComment,
      editComment,
      deleteComment,
      listCategories,
      createSchedule,
      getSchedule,
      replaceSchedule,
      removeSchedule,
      isLoading,
      error,
      clearError,
    }),
    [
      fetchList,
      getPayment,
      createPayment,
      updatePayment,
      removePayment,
      toggleStar,
      listComments,
      postComment,
      editComment,
      deleteComment,
      listCategories,
      createSchedule,
      getSchedule,
      replaceSchedule,
      removeSchedule,
      isLoading,
      error,
      clearError,
    ],
  );

  return <PaymentContext.Provider value={value}>{children}</PaymentContext.Provider>;
}

export function usePayments(): PaymentContextValue {
  const ctx = useContext(PaymentContext);
  if (!ctx) {
    throw new Error('usePayments must be used within a PaymentProvider');
  }
  return ctx;
}
