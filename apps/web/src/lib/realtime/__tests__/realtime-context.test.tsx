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
