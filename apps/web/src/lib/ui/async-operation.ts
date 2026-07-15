// Phase 6 · Iteration 6.16.2 — Type definitions for the global async-operation
// infrastructure. See docs/ui-async-conventions.md for the design rationale.

export type AsyncErrorReason = 'timeout' | 'network' | 'http' | 'aborted' | 'unknown';

export type AsyncPhase<T = unknown> =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      pendingId: string;
      startedAt: number;
      timeoutMs: number;
      previousData?: T;
    }
  | { kind: 'success'; data: T; finishedAt: number }
  | {
      kind: 'error';
      reason: AsyncErrorReason;
      httpStatus?: number;
      message?: string;
      previousData?: T;
    };

export type AsyncScope = 'page' | 'container' | 'control';

/** Default primary timeouts per scope (ms). */
export const DEFAULT_TIMEOUTS: Record<AsyncScope, number> = {
  page: 8000,
  container: 5000,
  control: 10000,
};

/** Default retry timeout — applied uniformly across scopes (ms). */
export const DEFAULT_RETRY_TIMEOUT_MS = 30000;

export interface UseAsyncOperationOptions {
  scope: AsyncScope;
  /** Override the per-scope default. */
  defaultTimeoutMs?: number;
  /** Override the universal retry timeout. */
  retryTimeoutMs?: number;
  /** Stable identifier for telemetry / dedup. Defaults to a generated UUID. */
  id?: string;
  /** Optional label for screen reader announcements. */
  label?: string;
}

export interface AsyncErrorInfo {
  reason: AsyncErrorReason;
  httpStatus?: number;
  message?: string;
}

/**
 * Lightweight error class — operations may throw this from `op()` to signal
 * a structured HTTP error. Plain `Error` and any other thrown value are
 * normalised to `{ reason: 'http' | 'network' | 'unknown' }` heuristically.
 */
export class AsyncHttpError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'AsyncHttpError';
    this.status = status;
  }
}

/** Best-effort classification of a thrown value into an `AsyncErrorReason`. */
export function classifyError(err: unknown): AsyncErrorInfo {
  if (err instanceof AsyncHttpError) {
    return { reason: 'http', httpStatus: err.status, message: err.message };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { reason: 'aborted', message: err.message };
  }
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'AbortError'
  ) {
    return { reason: 'aborted', message: (err as { message?: string }).message };
  }
  if (err instanceof TypeError) {
    // Browsers throw TypeError for failed fetches (network errors).
    return { reason: 'network', message: err.message };
  }
  if (err instanceof Error) {
    // Heuristic: transaction-context throws Error with a `status` property on HTTP failures.
    const status = (err as Error & { status?: number }).status;
    if (typeof status === 'number') {
      return { reason: 'http', httpStatus: status, message: err.message };
    }
    return { reason: 'unknown', message: err.message };
  }
  return { reason: 'unknown', message: typeof err === 'string' ? err : undefined };
}

/** Generate a UUID; falls back to a Math.random implementation when crypto is missing. */
export function generateOpId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'op-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}
