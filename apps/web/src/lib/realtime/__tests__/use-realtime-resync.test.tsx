import { fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeContext } from '../realtime-context';
import { useRealtimeResync } from '../use-realtime-resync';

function FakeProvider({ token, children }: { token: number; children: React.ReactNode }) {
  return (
    <RealtimeContext.Provider
      value={{
        connectionStatus: 'connected',
        resyncToken: token,
        subscribe: () => () => {},
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

function Probe({ refetch }: { refetch: () => void }) {
  useRealtimeResync(refetch);
  return null;
}

describe('useRealtimeResync', () => {
  it('does not call refetch on first mount (token === 0)', () => {
    const refetch = vi.fn();
    render(
      <FakeProvider token={0}>
        <Probe refetch={refetch} />
      </FakeProvider>,
    );
    expect(refetch).not.toHaveBeenCalled();
  });

  it('does not call refetch on first mount even when token is non-zero', () => {
    const refetch = vi.fn();
    render(
      <FakeProvider token={5}>
        <Probe refetch={refetch} />
      </FakeProvider>,
    );
    expect(refetch).not.toHaveBeenCalled();
  });

  it('calls refetch when token increments after mount', () => {
    const refetch = vi.fn();
    function Driver() {
      const [token, setToken] = useState(0);
      return (
        <FakeProvider token={token}>
          <Probe refetch={refetch} />
          <button data-testid="bump" onClick={() => setToken((t) => t + 1)}>
            bump
          </button>
        </FakeProvider>
      );
    }
    const { getByTestId } = render(<Driver />);
    expect(refetch).not.toHaveBeenCalled();

    fireEvent.click(getByTestId('bump'));
    expect(refetch).toHaveBeenCalledTimes(1);

    fireEvent.click(getByTestId('bump'));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('uses the latest refetch reference (no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    function Driver() {
      const [token, setToken] = useState(0);
      const [which, setWhich] = useState<'first' | 'second'>('first');
      return (
        <FakeProvider token={token}>
          <Probe refetch={which === 'first' ? first : second} />
          <button data-testid="bump" onClick={() => setToken((t) => t + 1)}>
            bump
          </button>
          <button data-testid="swap" onClick={() => setWhich('second')}>
            swap
          </button>
        </FakeProvider>
      );
    }
    const { getByTestId } = render(<Driver />);
    fireEvent.click(getByTestId('swap'));
    fireEvent.click(getByTestId('bump'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no provider is mounted', () => {
    const refetch = vi.fn();
    render(<Probe refetch={refetch} />);
    expect(refetch).not.toHaveBeenCalled();
  });
});
