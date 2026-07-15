import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '../realtime-context';
import type { RealtimeEvent } from '../realtime-types';
import { useRealtimeEvents } from '../use-realtime-events';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() {
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function TransactionListener({
  transactionId,
  onEvent,
}: {
  transactionId?: string;
  onEvent: (e: Extract<RealtimeEvent, { type: 'transaction.deleted' }>) => void;
}) {
  useRealtimeEvents({ type: 'transaction.deleted', transactionId }, onEvent);
  return null;
}

describe('useRealtimeEvents', () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource =
      MockEventSource;
  });

  afterEach(() => {
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });

  it('invokes the handler only for matching event types', () => {
    const handler = vi.fn();
    render(
      <RealtimeProvider enabled>
        <TransactionListener onEvent={handler} />
      </RealtimeProvider>,
    );
    act(() => {
      MockEventSource.instances[0]!.emit({ type: 'transaction.deleted', transactionId: 'p1' });
      MockEventSource.instances[0]!.emit({
        type: 'comment.deleted',
        transactionId: 'p1',
        commentId: 'c1',
      });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: 'transaction.deleted', transactionId: 'p1' });
  });

  it('filters by transactionId when provided', () => {
    const handler = vi.fn();
    render(
      <RealtimeProvider enabled>
        <TransactionListener transactionId="p1" onEvent={handler} />
      </RealtimeProvider>,
    );
    act(() => {
      MockEventSource.instances[0]!.emit({ type: 'transaction.deleted', transactionId: 'other' });
      MockEventSource.instances[0]!.emit({ type: 'transaction.deleted', transactionId: 'p1' });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toMatchObject({ transactionId: 'p1' });
  });

  it('cleans up on unmount', () => {
    const handler = vi.fn();
    const { unmount } = render(
      <RealtimeProvider enabled>
        <TransactionListener onEvent={handler} />
      </RealtimeProvider>,
    );
    unmount();
    // Provider closes the source on unmount; emitting on the (now closed) ES is a no-op
    // but we can also confirm the listener set was cleared by the unsubscribe contract.
    expect(MockEventSource.instances[0]!.closed).toBe(true);
  });

  it('uses the latest handler reference without re-subscribing', () => {
    const calls: string[] = [];
    let trigger: (l: string) => void = () => {};
    function Wrapper() {
      const [label, setLabel] = useState('a');
      trigger = setLabel;
      return (
        <TransactionListener
          onEvent={() => {
            calls.push(label);
          }}
        />
      );
    }
    render(
      <RealtimeProvider enabled>
        <Wrapper />
      </RealtimeProvider>,
    );
    act(() => {
      trigger('b');
    });
    act(() => {
      MockEventSource.instances[0]!.emit({ type: 'transaction.deleted', transactionId: 'p1' });
    });
    expect(calls).toEqual(['b']);
  });
});
