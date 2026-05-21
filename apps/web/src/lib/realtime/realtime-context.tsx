'use client';

// Phase 6 · Iteration 6.18.1.4 — RealtimeProvider.
//
// Owns the single EventSource connection for the authenticated user and
// fans events out to subscribers (`useRealtimeEvents`). The provider:
//   1. Opens `/api/v1/events/stream` with `withCredentials: true` so the
//      `access_token` cookie is sent. EventSource cannot set custom
//      headers — the cookie is the auth channel.
//   2. Reconnects with exponential backoff on errors (1s → 30s).
//   3. Suspends the connection while `document.hidden`, resumes on
//      visibility change. Page Visibility API saves a stream on every
//      open background tab.
//   4. Exposes `connectionStatus` for UI affordances.
//
// The provider is mounted only when authenticated (see [`apps/web/src/app/[locale]/layout.tsx`](../../app/%5Blocale%5D/layout.tsx)).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ConnectionStatus, RealtimeEvent } from './realtime-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';
const STREAM_URL = `${API_BASE}/events/stream`;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

type Listener = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  connectionStatus: ConnectionStatus;
  /** Subscribe to every event on the stream. Returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void;
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export interface RealtimeProviderProps {
  children: ReactNode;
  /** When false the provider is inert — used while user is not authenticated. */
  enabled?: boolean;
}

export function RealtimeProvider({ children, enabled = true }: RealtimeProviderProps) {
  const [connectionStatus, setStatus] = useState<ConnectionStatus>('disconnected');
  const listenersRef = useRef(new Set<Listener>());
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<number>(MIN_BACKOFF_MS);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const dispatch = useCallback((event: RealtimeEvent) => {
    for (const l of listenersRef.current) {
      try {
        l(event);
      } catch {
        // Subscribers must not break the stream — swallow errors.
      }
    }
  }, []);

  const close = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    if (sourceRef.current) return;
    setStatus((prev) => (prev === 'connected' ? prev : 'reconnecting'));

    const es = new EventSource(STREAM_URL, { withCredentials: true });
    sourceRef.current = es;

    es.onopen = () => {
      backoffRef.current = MIN_BACKOFF_MS;
      setStatus('connected');
    };

    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as RealtimeEvent;
        dispatch(parsed);
      } catch {
        // Malformed event — ignore.
      }
    };

    es.onerror = () => {
      // EventSource will auto-retry on its own for transient failures, but
      // we replace its policy with explicit backoff so the user-visible
      // status reflects reality and the timer is testable.
      es.close();
      sourceRef.current = null;
      setStatus('reconnecting');
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };
  }, [dispatch]);

  // Lifecycle: start / stop based on `enabled` and document visibility.
  useEffect(() => {
    if (!enabled) {
      close();
      setStatus('disconnected');
      return;
    }

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        close();
        setStatus('disconnected');
      } else {
        connect();
      }
    };

    if (typeof document !== 'undefined' && !document.hidden) {
      connect();
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      close();
    };
  }, [enabled, connect, close]);

  const value = useMemo<RealtimeContextValue>(
    () => ({ connectionStatus, subscribe }),
    [connectionStatus, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return ctx;
}
