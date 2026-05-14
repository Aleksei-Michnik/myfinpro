'use client';

// Phase 6 · Iteration 6.16.2 — universal async-operation hook.
// State machine: idle → loading → success | error.
// Manages AbortController, primary timeout, retry timeout, previousData.
// All callers in the project MUST use this for any fetch or mutation.
// See docs/ui-async-conventions.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyError,
  DEFAULT_RETRY_TIMEOUT_MS,
  DEFAULT_TIMEOUTS,
  generateOpId,
  type AsyncErrorInfo,
  type AsyncPhase,
  type UseAsyncOperationOptions,
} from './async-operation';
import { useOptionalUIStatus } from './ui-status-context';

export interface UseAsyncOperationResult<T> {
  phase: AsyncPhase<T>;
  data: T | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isIdle: boolean;
  error: AsyncErrorInfo | null;
  /**
   * Run the async operation. The op receives an AbortSignal and may either
   * return a value or throw. Resolves with the value on success, or
   * `undefined` on any failure (the error state is reflected on the hook).
   */
  run(
    op: (signal: AbortSignal) => Promise<T>,
    opts?: { timeoutMs?: number },
  ): Promise<T | undefined>;
  /** Re-issues the most recent op with the retry timeout. Resolves undefined when no op was recorded. */
  retry(): Promise<T | undefined>;
  /** Aborts the in-flight op and returns to idle. previousData is preserved on the hook's `data`. */
  cancel(): void;
  /** Aborts and clears all state (data + error). */
  reset(): void;
}

interface InternalRunState {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  pendingId: string;
  unregisterPageOp: (() => void) | null;
}

export function useAsyncOperation<T>(
  options: UseAsyncOperationOptions,
): UseAsyncOperationResult<T> {
  const { scope, defaultTimeoutMs, retryTimeoutMs, id: stableId } = options;

  const [phase, setPhase] = useState<AsyncPhase<T>>({ kind: 'idle' });

  // Track the in-flight controller / timer. Refs avoid re-renders.
  const runStateRef = useRef<InternalRunState | null>(null);
  // The most-recent op so retry() can re-issue it.
  const lastOpRef = useRef<((signal: AbortSignal) => Promise<T>) | null>(null);
  // Mounted flag to skip state updates after unmount.
  const mountedRef = useRef(true);
  // Cached identifier for telemetry; consumers may pass a stable one via options.
  const idRef = useRef(stableId ?? generateOpId());
  if (stableId && stableId !== idRef.current) {
    idRef.current = stableId;
  }
  // Previous successful data (for `previousData` on error).
  const previousDataRef = useRef<T | undefined>(undefined);

  // Optional access to the UIStatusProvider — only required for scope='page'.
  const uiStatus = useOptionalUIStatus();

  const primaryTimeout = defaultTimeoutMs ?? DEFAULT_TIMEOUTS[scope];
  const retryTimeout = retryTimeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS;

  const clearRunState = useCallback(() => {
    const rs = runStateRef.current;
    if (rs) {
      if (rs.timer) clearTimeout(rs.timer);
      rs.unregisterPageOp?.();
      runStateRef.current = null;
    }
  }, []);

  const performRun = useCallback(
    async (op: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T | undefined> => {
      // Abort any previous operation; transition to loading.
      const previous = runStateRef.current;
      if (previous) {
        previous.controller.abort();
        if (previous.timer) clearTimeout(previous.timer);
        previous.unregisterPageOp?.();
      }

      const controller = new AbortController();
      const pendingId = idRef.current;
      const startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unregisterPageOp: (() => void) | null = null;

      // Page-scope ops register with the bus to drive <PageProgressBar>.
      if (scope === 'page' && uiStatus) {
        unregisterPageOp = uiStatus.registerPageOp(pendingId);
      }

      const state: InternalRunState = {
        controller,
        timer: null,
        pendingId,
        unregisterPageOp,
      };
      runStateRef.current = state;

      // Start the timeout — abort on expiry, mark reason='timeout'.
      let timedOut = false;
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      state.timer = timer;

      lastOpRef.current = op;

      // Capture the previous data BEFORE we overwrite phase. This survives
      // both error and cancel.
      const carryData = previousDataRef.current;

      if (mountedRef.current) {
        setPhase({
          kind: 'loading',
          pendingId,
          startedAt,
          timeoutMs,
          previousData: carryData,
        });
      }

      try {
        const result = await op(controller.signal);

        // The current run may have been superseded by a newer one; ignore.
        if (runStateRef.current !== state) {
          return undefined;
        }

        if (timer) clearTimeout(timer);
        unregisterPageOp?.();
        runStateRef.current = null;

        previousDataRef.current = result;

        if (mountedRef.current) {
          setPhase({ kind: 'success', data: result, finishedAt: Date.now() });
        }
        return result;
      } catch (err) {
        // The current run may have been superseded; the new run owns the state.
        if (runStateRef.current !== state) {
          return undefined;
        }

        if (timer) clearTimeout(timer);
        unregisterPageOp?.();
        runStateRef.current = null;

        const info = classifyError(err);
        // If we triggered the abort via timeout, classify as timeout.
        const reason = timedOut ? 'timeout' : info.reason;

        if (mountedRef.current) {
          setPhase({
            kind: 'error',
            reason,
            httpStatus: info.httpStatus,
            message: info.message,
            previousData: previousDataRef.current,
          });
        }
        return undefined;
      }
    },
    [scope, uiStatus],
  );

  const run = useCallback(
    (op: (signal: AbortSignal) => Promise<T>, opts?: { timeoutMs?: number }) =>
      performRun(op, opts?.timeoutMs ?? primaryTimeout),
    [performRun, primaryTimeout],
  );

  const retry = useCallback((): Promise<T | undefined> => {
    const op = lastOpRef.current;
    if (!op) return Promise.resolve(undefined);
    return performRun(op, retryTimeout);
  }, [performRun, retryTimeout]);

  const cancel = useCallback(() => {
    const rs = runStateRef.current;
    if (rs) {
      rs.controller.abort();
      if (rs.timer) clearTimeout(rs.timer);
      rs.unregisterPageOp?.();
      runStateRef.current = null;
    }
    if (mountedRef.current) {
      // Return to idle but keep `data` (preserved on the ref, exposed below).
      setPhase({ kind: 'idle' });
    }
  }, []);

  const reset = useCallback(() => {
    clearRunState();
    previousDataRef.current = undefined;
    lastOpRef.current = null;
    if (mountedRef.current) {
      setPhase({ kind: 'idle' });
    }
  }, [clearRunState]);

  // Cleanup on unmount: abort, clear timers, drop bus registration.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const rs = runStateRef.current;
      if (rs) {
        rs.controller.abort();
        if (rs.timer) clearTimeout(rs.timer);
        rs.unregisterPageOp?.();
        runStateRef.current = null;
      }
    };
  }, []);

  // Derived state.
  const isLoading = phase.kind === 'loading';
  const isSuccess = phase.kind === 'success';
  const isError = phase.kind === 'error';
  const isIdle = phase.kind === 'idle';

  const data = useMemo<T | undefined>(() => {
    if (phase.kind === 'success') return phase.data;
    if (phase.kind === 'loading') return phase.previousData;
    if (phase.kind === 'error') return phase.previousData;
    // idle — surface previous data (preserved across cancel).
    return previousDataRef.current;
  }, [phase]);

  const error = useMemo<AsyncErrorInfo | null>(() => {
    if (phase.kind !== 'error') return null;
    return {
      reason: phase.reason,
      httpStatus: phase.httpStatus,
      message: phase.message,
    };
  }, [phase]);

  return {
    phase,
    data,
    isLoading,
    isSuccess,
    isError,
    isIdle,
    error,
    run,
    retry,
    cancel,
    reset,
  };
}
