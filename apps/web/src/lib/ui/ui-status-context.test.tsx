import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UIStatusProvider, useUIStatus } from './ui-status-context';

const pathnameMock = vi.fn(() => '/');
const searchParamsMock = vi.fn(() => new URLSearchParams());

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
  useSearchParams: () => searchParamsMock(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  pathnameMock.mockReturnValue('/');
  searchParamsMock.mockReturnValue(new URLSearchParams());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UIStatusContext', () => {
  it('useUIStatus throws when used outside the provider', () => {
    expect(() => renderHook(() => useUIStatus())).toThrow(
      /useUIStatus must be used within a UIStatusProvider/,
    );
  });

  it('registerPageOp(id) increments the counter and returns an unregister fn that decrements', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking>{children}</UIStatusProvider>
      ),
    });
    expect(result.current.activePageOps).toBe(0);
    let unregister!: () => void;
    act(() => {
      unregister = result.current.registerPageOp('a');
    });
    expect(result.current.activePageOps).toBe(1);
    act(() => unregister());
    expect(result.current.activePageOps).toBe(0);
  });

  it('multiple ops accumulate; unregistering each one drops the count back to zero (never negative)', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking>{children}</UIStatusProvider>
      ),
    });
    let u1!: () => void;
    let u2!: () => void;
    let u3!: () => void;
    act(() => {
      u1 = result.current.registerPageOp('a');
      u2 = result.current.registerPageOp('b');
      u3 = result.current.registerPageOp('c');
    });
    expect(result.current.activePageOps).toBe(3);
    act(() => {
      u1();
      // Calling u1 again is a no-op.
      u1();
    });
    expect(result.current.activePageOps).toBe(2);
    act(() => u2());
    act(() => u3());
    expect(result.current.activePageOps).toBe(0);
  });

  it('pathname change registers a brief 250ms op then unregisters', async () => {
    pathnameMock.mockReturnValue('/start');
    function Probe() {
      const { activePageOps } = useUIStatus();
      return <span data-testid="count">{activePageOps}</span>;
    }
    const { rerender } = render(
      <UIStatusProvider>
        <Probe />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('0');

    // Simulate route change.
    pathnameMock.mockReturnValue('/next');
    act(() => {
      rerender(
        <UIStatusProvider>
          <Probe />
        </UIStatusProvider>,
      );
    });
    expect(screen.getByTestId('count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('searchParams-only change does NOT register a navigation flash', () => {
    pathnameMock.mockReturnValue('/static');
    searchParamsMock.mockReturnValue(new URLSearchParams('?q=a'));
    function Probe() {
      const { activePageOps } = useUIStatus();
      return <span data-testid="count">{activePageOps}</span>;
    }
    const { rerender } = render(
      <UIStatusProvider>
        <Probe />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('0');
    searchParamsMock.mockReturnValue(new URLSearchParams('?q=b'));
    act(() => {
      rerender(
        <UIStatusProvider>
          <Probe />
        </UIStatusProvider>,
      );
    });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('counter is observable from a child component (re-renders on change)', () => {
    function Probe() {
      const { activePageOps, registerPageOp } = useUIStatus();
      return (
        <button data-testid="probe" onClick={() => registerPageOp('x')}>
          {activePageOps}
        </button>
      );
    }
    render(
      <UIStatusProvider disablePathnameTracking>
        <Probe />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('0');
    act(() => screen.getByTestId('probe').click());
    expect(screen.getByTestId('probe').textContent).toBe('1');
  });

  it('disablePathnameTracking prevents the auto-flash on route change', () => {
    pathnameMock.mockReturnValue('/start');
    function Probe() {
      const { activePageOps } = useUIStatus();
      return <span data-testid="count">{activePageOps}</span>;
    }
    const { rerender } = render(
      <UIStatusProvider disablePathnameTracking>
        <Probe />
      </UIStatusProvider>,
    );
    pathnameMock.mockReturnValue('/different');
    act(() => {
      rerender(
        <UIStatusProvider disablePathnameTracking>
          <Probe />
        </UIStatusProvider>,
      );
    });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
