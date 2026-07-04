'use client';

// Phase 6 · 6.18.1.4-hotfix (part 2) — gap-recovery refetch hook.
//
// Subscribed views call this hook with their idempotent loader. Whenever
// the realtime provider's `resyncToken` changes (a reconnect-after-gap),
// the loader runs — events published into the gap were lost, and the
// loader's full refetch makes the view authoritative again. The hook is
// a no-op until the token actually changes, so first-mount fetches stay
// owned by each view's own effect (no double-fetch on mount).
//
// Refetch is inherently idempotent: it overwrites local state with
// server truth, so echoes of a tab's own mutations are harmless.

import { useContext, useEffect, useRef } from 'react';
import { RealtimeContext } from './realtime-context';

export type Refetch = () => void | Promise<unknown>;

export function useRealtimeResync(refetch: Refetch): void {
  // Degrades gracefully when no provider is mounted (component-only tests).
  const ctx = useContext(RealtimeContext);
  const token = ctx?.resyncToken ?? 0;

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Skip the very first effect run — views fetch on mount via their own
  // effect; we only react to subsequent token changes.
  const lastSeenRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastSeenRef.current === null) {
      lastSeenRef.current = token;
      return;
    }
    if (lastSeenRef.current === token) return;
    lastSeenRef.current = token;
    void refetchRef.current();
  }, [token]);
}
