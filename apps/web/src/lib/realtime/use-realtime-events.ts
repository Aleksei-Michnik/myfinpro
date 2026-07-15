'use client';

// Phase 6 · Iteration 6.18.1.4 — single hook for all realtime subscriptions.
//
// Components subscribe by event type and (optionally) tighter criteria.
// The hook does the work of:
//   - subscribing on mount / unsubscribing on unmount,
//   - filtering by `type` (always) and any extra fields the caller cares
//     about (`transactionId` covers most use cases),
//   - keeping the latest handler reference without re-subscribing on every
//     render.

import { useContext, useEffect, useRef } from 'react';
import { RealtimeContext } from './realtime-context';
import type { RealtimeEvent, RealtimeEventType } from './realtime-types';

type Handler<T extends RealtimeEventType> = (event: Extract<RealtimeEvent, { type: T }>) => void;

export interface RealtimeFilter<T extends RealtimeEventType> {
  type: T;
  /** Match events that carry this `transactionId` (when applicable). */
  transactionId?: string;
  /** Match events that carry this `parentTransactionId` (occurrence events). */
  parentTransactionId?: string;
  /** Match events that carry this `commentId`. */
  commentId?: string;
}

function eventMatches<T extends RealtimeEventType>(
  event: RealtimeEvent,
  filter: RealtimeFilter<T>,
): event is Extract<RealtimeEvent, { type: T }> {
  if (event.type !== filter.type) return false;
  // Use a permissive index access — the discriminated union narrows at the
  // call site, but here we're dispatching dynamically.
  const e = event as unknown as Record<string, unknown>;
  if (filter.transactionId !== undefined && e.transactionId !== filter.transactionId) return false;
  if (
    filter.parentTransactionId !== undefined &&
    e.parentTransactionId !== filter.parentTransactionId
  ) {
    return false;
  }
  if (filter.commentId !== undefined && e.commentId !== filter.commentId) return false;
  return true;
}

export function useRealtimeEvents<T extends RealtimeEventType>(
  filter: RealtimeFilter<T>,
  handler: Handler<T>,
): void {
  // The hook degrades to a no-op when no provider is mounted. This keeps
  // unit tests that focus on a single feature from having to wrap every
  // render in a RealtimeProvider — the real authenticated layout always
  // mounts one.
  const ctx = useContext(RealtimeContext);
  const subscribe = ctx?.subscribe;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Stable filter object: only re-subscribe when the meaningful fields
  // change.
  const { type, transactionId, parentTransactionId, commentId } = filter;

  useEffect(() => {
    if (!subscribe) return;
    const f: RealtimeFilter<T> = { type, transactionId, parentTransactionId, commentId };
    const unsub = subscribe((event) => {
      if (eventMatches(event, f)) {
        handlerRef.current(event);
      }
    });
    return unsub;
  }, [subscribe, type, transactionId, parentTransactionId, commentId]);
}
