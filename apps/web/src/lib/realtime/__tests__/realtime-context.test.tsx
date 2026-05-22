import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider, useRealtime } from '../realtime-context';
import type { ConnectionStatus, RealtimeEvent } from '../realtime-types';

// ── Minimal EventSource mock ───────────────────────────────────────────
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  closed = false;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emitOpen() {
    this.onopen?.call(this as unknown as EventSource, new Event('open'));
  }
  emitMessage(data: unknown) {
    this.onmessage?.call(
      this as unknown as EventSource,
      { data: JSON.stringify(data) } as MessageEvent,
    );
  }
  emitError() {
    this.onerror?.call(this as unknown as EventSource, new Event('error'));
  }
}

// ── Probe component reading the context ────────────────────────────────
function Probe({
  onStatus,
  onEvent,
}: {
  onStatus?: (s: ConnectionStatus) => void;
  onEvent?: (e: RealtimeEvent) => void;
}) {
  const { connectionStatus, subscribe } = useRealtime();
  if (onStatus) onStatus(connectionStatus);
  // Subscribe once via a stable closure.
  if (onEvent) {
    // Subscribe on first render via a side effect-ish pattern (acceptable
    // here because the provider already memoises `subscribe`).
    if (!(Probe as unknown as { _subbed?: boolean })._subbed) {
      (Probe as unknown as { _subbed: boolean })._subbed = true;
      subscribe(onEvent);
    }
  }
  return <span>{connectionStatus}</span>;
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    (Probe as unknown as { _subbed?: boolean })._subbed = false;
    vi.useFakeTimers();
    (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });

  it('opens an EventSource when enabled and reports connected after onopen', () => {
    const statuses: ConnectionStatus[] = [];
    render(
      <RealtimeProvider enabled>
        <Probe onStatus={(s) => statuses.push(s)} />
      </RealtimeProvider>,
    );
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.withCredentials).toBe(true);

    act(() => {
      MockEventSource.instances[0]!.emitOpen();
    });
    expect(statuses).toContain('connected');
  });

  it('does not open EventSource when disabled', () => {
    render(
      <RealtimeProvider enabled={false}>
        <Probe />
      </RealtimeProvider>,
    );
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('dispatches parsed events to subscribers', () => {
    const seen: RealtimeEvent[] = [];
    render(
      <RealtimeProvider enabled>
        <Probe onEvent={(e) => seen.push(e)} />
      </RealtimeProvider>,
    );
    act(() => {
      MockEventSource.instances[0]!.emitOpen();
      MockEventSource.instances[0]!.emitMessage({
        type: 'payment.deleted',
        paymentId: 'p1',
      });
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'payment.deleted', paymentId: 'p1' });
  });

  it('reconnects with exponential backoff on error', () => {
    render(
      <RealtimeProvider enabled>
        <Probe />
      </RealtimeProvider>,
    );
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      MockEventSource.instances[0]!.emitError();
    });
    expect(MockEventSource.instances[0]!.closed).toBe(true);
    // First retry after 1s
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      MockEventSource.instances[1]!.emitError();
    });
    // Backoff doubled to 2s
    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it('closes the stream on unmount', () => {
    const { unmount } = render(
      <RealtimeProvider enabled>
        <Probe />
      </RealtimeProvider>,
    );
    expect(MockEventSource.instances).toHaveLength(1);
    unmount();
    expect(MockEventSource.instances[0]!.closed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 6 · 6.18.1.4-hotfix — failure cap + BroadcastChannel reconnect.
// ─────────────────────────────────────────────────────────────────────

import { AUTH_BROADCAST_CHANNEL, TOKEN_REFRESHED_MESSAGE } from '../../api-client';
import { MAX_CONSECUTIVE_FAILURES_FOR_TESTS } from '../realtime-context';

describe('RealtimeProvider — reconnect policy (Phase 6 · 6.18.1.4-hotfix)', () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    (Probe as unknown as { _subbed?: boolean })._subbed = false;
    vi.useFakeTimers();
    (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });

  it('exposes a 5-failure cap', () => {
    expect(MAX_CONSECUTIVE_FAILURES_FOR_TESTS).toBe(5);
  });

  it('stops reconnecting after MAX_CONSECUTIVE_FAILURES consecutive errors', () => {
    render(
      <RealtimeProvider enabled>
        <Probe />
      </RealtimeProvider>,
    );
    expect(MockEventSource.instances).toHaveLength(1);

    // Each error → close → schedule reconnect (capped 30s backoff).
    // After 5 errors total there should be no further connect.
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_FOR_TESTS; i++) {
      act(() => {
        MockEventSource.instances[i]!.emitError();
      });
      // Drain the backoff timer.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
    }

    // At most MAX_CONSECUTIVE_FAILURES instances were created.
    expect(MockEventSource.instances.length).toBeLessThanOrEqual(
      MAX_CONSECUTIVE_FAILURES_FOR_TESTS,
    );

    // Advancing time further does NOT spin up a new connection — the
    // provider is now silently disconnected.
    const before = MockEventSource.instances.length;
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(MockEventSource.instances.length).toBe(before);
  });

  it('reconnects on a token-refreshed broadcast even after the failure cap', () => {
    // Capture broadcast listeners installed by the provider.
    const listeners = new Set<(ev: MessageEvent) => void>();
    let observedName: string | null = null;
    class TestChannel {
      constructor(name: string) {
        observedName = name;
      }
      addEventListener(_t: string, fn: (ev: MessageEvent) => void) {
        listeners.add(fn);
      }
      removeEventListener(_t: string, fn: (ev: MessageEvent) => void) {
        listeners.delete(fn);
      }
      postMessage(_d: unknown) {}
      close() {}
    }
    const original = global.BroadcastChannel;
    global.BroadcastChannel = TestChannel as unknown as typeof BroadcastChannel;

    try {
      render(
        <RealtimeProvider enabled>
          <Probe />
        </RealtimeProvider>,
      );
      expect(observedName).toBe(AUTH_BROADCAST_CHANNEL);

      // Exhaust the failure cap.
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_FOR_TESTS; i++) {
        act(() => {
          MockEventSource.instances[i]!.emitError();
        });
        act(() => {
          vi.advanceTimersByTime(60_000);
        });
      }
      const beforeBroadcast = MockEventSource.instances.length;

      // A token-refreshed broadcast should reconnect immediately.
      act(() => {
        for (const fn of listeners) {
          fn({
            data: { type: TOKEN_REFRESHED_MESSAGE, accessToken: 'fresh' },
          } as MessageEvent);
        }
      });

      expect(MockEventSource.instances.length).toBe(beforeBroadcast + 1);
    } finally {
      global.BroadcastChannel = original;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 6 · 6.18.1.4-hotfix — failure cap + BroadcastChannel reconnect.
// ─────────────────────────────────────────────────────────────────────

import { AUTH_BROADCAST_CHANNEL, TOKEN_REFRESHED_MESSAGE } from '../../api-client';
import { MAX_CONSECUTIVE_FAILURES_FOR_TESTS } from '../realtime-context';

describe('RealtimeProvider — reconnect policy (Phase 6 · 6.18.1.4-hotfix)', () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    (Probe as unknown as { _subbed?: boolean })._subbed = false;
    vi.useFakeTimers();
    (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });

  it('exposes a 5-failure cap', () => {
    expect(MAX_CONSECUTIVE_FAILURES_FOR_TESTS).toBe(5);
  });

  it('stops reconnecting after MAX_CONSECUTIVE_FAILURES consecutive errors', () => {
    render(
      <RealtimeProvider enabled>
        <Probe />
      </RealtimeProvider>,
    );
    expect(MockEventSource.instances).toHaveLength(1);

    // Each error → close → schedule reconnect (capped 30s backoff).
    // After 5 errors total there should be no further connect.
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_FOR_TESTS; i++) {
      act(() => {
        MockEventSource.instances[i]!.emitError();
      });
      // Drain the backoff timer.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
    }

    // At most MAX_CONSECUTIVE_FAILURES instances were created.
    expect(MockEventSource.instances.length).toBeLessThanOrEqual(
      MAX_CONSECUTIVE_FAILURES_FOR_TESTS,
    );

    // Advancing time further does NOT spin up a new connection — the
    // provider is now silently disconnected.
    const before = MockEventSource.instances.length;
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(MockEventSource.instances.length).toBe(before);
  });

  it('reconnects on a token-refreshed broadcast even after the failure cap', () => {
    // Capture broadcast listeners installed by the provider.
    const listeners = new Set<(ev: MessageEvent) => void>();
    let observedName: string | null = null;
    class TestChannel {
      constructor(name: string) {
        observedName = name;
      }
      addEventListener(_t: string, fn: (ev: MessageEvent) => void) {
        listeners.add(fn);
      }
      removeEventListener(_t: string, fn: (ev: MessageEvent) => void) {
        listeners.delete(fn);
      }
      postMessage(_d: unknown) {}
      close() {}
    }
    const original = global.BroadcastChannel;
    global.BroadcastChannel = TestChannel as unknown as typeof BroadcastChannel;

    try {
      render(
        <RealtimeProvider enabled>
          <Probe />
        </RealtimeProvider>,
      );
      expect(observedName).toBe(AUTH_BROADCAST_CHANNEL);

      // Exhaust the failure cap.
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_FOR_TESTS; i++) {
        act(() => {
          MockEventSource.instances[i]!.emitError();
        });
        act(() => {
          vi.advanceTimersByTime(60_000);
        });
      }
      const beforeBroadcast = MockEventSource.instances.length;

      // A token-refreshed broadcast should reconnect immediately.
      act(() => {
        for (const fn of listeners) {
          fn({
            data: { type: TOKEN_REFRESHED_MESSAGE, accessToken: 'fresh' },
          } as MessageEvent);
        }
      });

      expect(MockEventSource.instances.length).toBe(beforeBroadcast + 1);
    } finally {
      global.BroadcastChannel = original;
    }
  });
});
