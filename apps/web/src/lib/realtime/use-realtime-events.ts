'use client';

// Phase 6 · Iteration 6.18.1.4 — single hook for all realtime subscriptions.
//
// Components subscribe by event type and (optionally) tighter criteria.
// The hook does the work of:
//   - subscribing on mount / unsubscribing on unmount,
//   - filtering by `type` (always) and any extra fields the caller cares
//     about (`paymentId` covers most use cases),
//   - keeping the latest handler reference without re-subscribing on every
//     render.

import { useEffect, useRef } from 'react';
import { useRealtime } from './realtime-context';
import type { RealtimeEvent, RealtimeEventType } from './realtime-types';

type Handler<T extends RealtimeEventType> = (event: Extract<RealtimeEvent, { type: T }>) => void;

export interface RealtimeFilter<T extends RealtimeEventType> {
  type: T;
  /** Match events that carry this `paymentId` (when applicable). */
  paymentId?: string;
  /** Match events that carry this `parentPaymentId` (occurrence events). */
  parentPaymentId?: string;
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
  if (filter.paymentId !== undefined && e.paymentId !== filter.paymentId) return false;
  if (filter.parentPaymentId !== undefined && e.parentPaymentId !== filter.parentPaymentId) {
    return false;
  }
  if (filter.commentId !== undefined && e.commentId !== filter.commentId) return false;
  return true;
}

export function useRealtimeEvents<T extends RealtimeEventType>(
  filter: RealtimeFilter<T>,
  handler: Handler<T>,
): void {
  const { subscribe } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Stable filter object: only re-subscribe when the meaningful fields
  // change.
  const { type, paymentId, parentPaymentId, commentId } = filter;

  useEffect(() => {
    const f: RealtimeFilter<T> = { type, paymentId, parentPaymentId, commentId };
    const unsub = subscribe((event) => {
      if (eventMatches(event, f)) {
        handlerRef.current(event);
      }
    });
    return unsub;
  }, [subscribe, type, paymentId, parentPaymentId, commentId]);
}
