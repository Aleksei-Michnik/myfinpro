'use client';

// Phase 6 · Iteration 6.18.1.4 — RealtimeProvider.
// Phase 6 · 6.18.1.4-hotfix — reconnect policy aligned with the auth
// refresh path:
//
//   * After MAX_CONSECUTIVE_FAILURES (5) consecutive `onerror` events
//     the provider stops retrying. The app stays usable via regular
//     fetches; the SSE channel just goes silent until something
//     re-mounts the provider or a token-refresh broadcast arrives.
//
//   * The provider listens on `BroadcastChannel('auth')` for
//     `{ type: 'token-refreshed' }`. Receiving that message resets the
//     failure counter and reconnects immediately — the cookie is fresh,
//     so the next stream open should succeed.
//
//   * The provider does NOT call `/auth/refresh` itself. Refreshing is
//     owned by `auth-context` (proactive interval) and the api-client
//     401 interceptor (reactive). Keeping a single refresh path
//     prevents double-refreshes / token reuse races.
//
// Phase 6 · 6.18.1.4-hotfix (part 2) — gap recovery via `resyncToken`:
//
//   The SSE channel is live-only: the in-memory server bus has no buffer
//   and no `Last-Event-ID` replay, so every event published while this
//   tab's stream was closed (hidden tab, backoff window, broadcast-driven
//   reconnect) is lost forever. To make the close-on-hidden policy
//   correct, the provider exposes `resyncToken` — a counter bumped on
//   every reconnect-after-gap (an `onopen` that follows a previously
//   created EventSource). Subscribed views MUST refetch their data when
//   the token changes (see `useRealtimeResync`). The very first open of
//   a session does not bump — there is no gap to recover and views have
//   just fetched on mount.

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
import {
  AUTH_BROADCAST_CHANNEL,
  TOKEN_REFRESHED_MESSAGE,
  type AuthBroadcastMessage,
} from '@/lib/api-client';
import type { ConnectionStatus, RealtimeEvent } from './realtime-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';
const STREAM_URL = `${API_BASE}/events/stream`;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/**
 * After this many consecutive failures (without a successful `onopen`
 * in between) the provider stops scheduling new reconnects. A
 * `token-refreshed` broadcast resets the counter.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

type Listener = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  connectionStatus: ConnectionStatus;
  /**
   * Increments on every reconnect-after-gap (an `onopen` following a
   * previously created EventSource). Stays 0 until the first gap.
   * Subscribed views MUST refetch their data when this changes — events
   * published while the stream was down are lost (no server-side replay).
   */
  resyncToken: number;
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
  const [resyncToken, setResyncToken] = useState(0);
  const listenersRef = useRef(new Set<Listener>());
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<number>(MIN_BACKOFF_MS);
  const failureCountRef = useRef<number>(0);
  // True once any EventSource has been created this session. Used to tell
  // a first connect (no gap — don't bump resyncToken) from a reconnect
  // after the previous stream was torn down (gap — bump on open).
  const hadStreamRef = useRef(false);

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

    // Any EventSource created after a previous one existed means events
    // may have been published into the gap — flag it so `onopen` bumps
    // `resyncToken` and subscribed views refetch.
    const isReconnectAfterGap = hadStreamRef.current;
    hadStreamRef.current = true;

    const es = new EventSource(STREAM_URL, { withCredentials: true });
    sourceRef.current = es;

    es.onopen = () => {
      backoffRef.current = MIN_BACKOFF_MS;
      failureCountRef.current = 0;
      if (isReconnectAfterGap) {
        setResyncToken((t) => t + 1);
      }
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

      failureCountRef.current += 1;
      // Stop retrying after the cap — we expect a token-refresh
      // broadcast to bring us back. EventSource cannot expose the HTTP
      // status of the failed request, so we use the failure count as a
      // proxy for "the server keeps rejecting us, probably 401".
      if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setStatus('disconnected');
        return;
      }

      setStatus('reconnecting');
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };
  }, [dispatch]);

  // Reconnect immediately on a cross-tab/intra-tab token-refresh
  // broadcast. This is the *only* path that resets the failure counter
  // automatically — without it, a session that hits the 5-failure cap
  // would stay disconnected until the user navigated.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    const onMessage = (ev: MessageEvent<AuthBroadcastMessage>) => {
      if (ev.data?.type !== TOKEN_REFRESHED_MESSAGE) return;
      // Token rotated — clear the cap and the pending backoff, then
      // re-open with the fresh cookie.
      failureCountRef.current = 0;
      backoffRef.current = MIN_BACKOFF_MS;
      close();
      connect();
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [enabled, close, connect]);

  // Lifecycle: start / stop based on `enabled` and document visibility.
  useEffect(() => {
    if (!enabled) {
      close();
      setStatus('disconnected');
      failureCountRef.current = 0;
      // A disabled provider (logged out) starts a fresh session on
      // re-enable — its first open is not a gap to recover.
      hadStreamRef.current = false;
      return;
    }

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        close();
        setStatus('disconnected');
      } else {
        // Resuming from a hidden tab is a fresh chance — reset the
        // failure counter so the cap doesn't bite mid-session.
        failureCountRef.current = 0;
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
    () => ({ connectionStatus, resyncToken, subscribe }),
    [connectionStatus, resyncToken, subscribe],
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

/** Test-only — mirror of the cap so the test file stays in sync. */
export const MAX_CONSECUTIVE_FAILURES_FOR_TESTS = MAX_CONSECUTIVE_FAILURES;
