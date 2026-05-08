'use client';

// Phase 6 · Iteration 6.14 — Shared star-toggle hook with optimistic
// flip + revert-on-error semantics. Extracted from `<PaymentRow>` so that
// `<PaymentDetailHeader>` can share the exact same behaviour (DRY).
//
// Usage:
//   const { starred, error, toggle } = useStarToggle(payment.id, payment.starredByMe, {
//     onToggled: (id, starred) => { /* bubble-up */ },
//   });
//   <button onClick={toggle}>{starred ? '★' : '☆'}</button>

import { useCallback, useEffect, useState } from 'react';
import { usePayments } from './payment-context';

export interface UseStarToggleOptions {
  /** Called with the authoritative `starred` value returned by the server. */
  onToggled?: (paymentId: string, starred: boolean) => void;
}

export interface UseStarToggleResult {
  /** Current (optimistic-then-confirmed) starred state. */
  starred: boolean;
  /** Populated when the last toggle failed. Cleared on the next attempt. */
  error: string | null;
  /** Whether a network round-trip is currently in flight. */
  pending: boolean;
  /** Fires the toggle. Safe to call from a click handler (stops propagation is the caller's job). */
  toggle: () => Promise<void>;
}

export function useStarToggle(
  paymentId: string,
  initialStarred: boolean,
  options: UseStarToggleOptions = {},
): UseStarToggleResult {
  const { toggleStar } = usePayments();
  const [starred, setStarred] = useState(initialStarred);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Keep in sync when the parent-prop changes (e.g. re-fetched payment).
  useEffect(() => {
    setStarred(initialStarred);
  }, [initialStarred]);

  const toggle = useCallback(async () => {
    const previous = starred;
    setStarred(!previous);
    setError(null);
    setPending(true);
    try {
      const r = await toggleStar(paymentId);
      setStarred(r.starred);
      options.onToggled?.(paymentId, r.starred);
    } catch (err) {
      setStarred(previous);
      setError((err as Error).message || 'star failed');
    } finally {
      setPending(false);
    }
  }, [paymentId, starred, toggleStar, options]);

  return { starred, error, pending, toggle };
}
