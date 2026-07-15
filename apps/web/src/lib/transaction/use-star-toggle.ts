'use client';

// Phase 6 · Iteration 6.14 — shared star-toggle hook with optimistic flip +
// revert-on-error semantics. Extracted from `<TransactionRow>` so that
// `<TransactionDetailHeader>` can share the exact same behaviour (DRY).
//
// Phase 6 · Iteration 6.16.2 — internally rebuilt on top of
// `useAsyncOperation({ scope: 'control' })`. The control-scope hook gives
// us AbortController-managed cancellation on unmount, a 10 s default
// timeout, and a 30 s retry timeout — without any per-component bookkeeping.
// Public API is unchanged plus a new `pending` flag (already exposed) and
// the `error` is now a structured object (rendered as a string by the
// existing consumers via `error.message`).
//
// Usage:
//   const { starred, error, pending, toggle } = useStarToggle(transaction.id, transaction.starredByMe, {
//     onToggled: (id, starred) => { /* bubble-up */ },
//   });
//   <button disabled={pending} aria-busy={pending} onClick={toggle}>
//     {pending ? <ButtonSpinner /> : (starred ? '★' : '☆')}
//   </button>

import { useCallback, useEffect, useState } from 'react';
import { useTransactions } from './transaction-context';
import { useAsyncOperation } from '@/lib/ui';

export interface UseStarToggleOptions {
  /** Called with the authoritative `starred` value returned by the server. */
  onToggled?: (transactionId: string, starred: boolean) => void;
}

export interface UseStarToggleResult {
  /** Current (optimistic-then-confirmed) starred state. */
  starred: boolean;
  /** Populated when the last toggle failed. Cleared on the next attempt. */
  error: string | null;
  /** Whether a network round-trip is currently in flight. */
  pending: boolean;
  /** Fires the toggle. Safe to call from a click handler. */
  toggle: () => Promise<void>;
}

export function useStarToggle(
  transactionId: string,
  initialStarred: boolean,
  options: UseStarToggleOptions = {},
): UseStarToggleResult {
  const { toggleStar } = useTransactions();
  const [starred, setStarred] = useState(initialStarred);
  const op = useAsyncOperation<{ starred: boolean }>({
    scope: 'control',
    id: `star:${transactionId}`,
  });

  // Keep in sync when the parent-prop changes (e.g. re-fetched transaction).
  useEffect(() => {
    setStarred(initialStarred);
  }, [initialStarred]);

  const toggle = useCallback(async () => {
    const previous = starred;
    // Optimistic flip — visible immediately.
    setStarred(!previous);
    const result = await op.run((signal) => toggleStar(transactionId, signal));
    if (result === undefined) {
      // Failure path — revert and surface the error message.
      setStarred(previous);
      return;
    }
    setStarred(result.starred);
    options.onToggled?.(transactionId, result.starred);
  }, [transactionId, starred, toggleStar, op, options]);

  // Surface the structured error as a string for backward compatibility with
  // existing consumers that show `error` in a `title=` attribute.
  const errorMessage = op.error?.message
    ? op.error.message
    : op.error
      ? `Star ${op.error.reason} error`
      : null;

  return {
    starred,
    error: errorMessage,
    pending: op.isLoading,
    toggle,
  };
}
