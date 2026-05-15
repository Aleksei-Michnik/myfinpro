import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NAV_FADE_OUT_MS,
  NAV_SAFETY_TIMEOUT_MS,
  NAV_VISIBILITY_DEBOUNCE_MS,
  shouldInterceptAnchorClick,
  UIStatusProvider,
  useUIStatus,
} from './ui-status-context';

const pathnameMock = vi.fn(() => '/');
const searchParamsMock = vi.fn(() => new URLSearchParams());
const localeMock = vi.fn(() => 'en');

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
  useSearchParams: () => searchParamsMock(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => localeMock(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  pathnameMock.mockReturnValue('/');
  searchParamsMock.mockReturnValue(new URLSearchParams());
  localeMock.mockReturnValue('en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Existing 6.16.2 API surface ─────────────────────────────────────────────
describe('UIStatusContext — existing API', () => {
  it('useUIStatus throws when used outside the provider', () => {
    expect(() => renderHook(() => useUIStatus())).toThrow(
      /useUIStatus must be used within a UIStatusProvider/,
    );
  });

  it('registerPageOp(id) increments the counter and returns an unregister fn that decrements', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
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
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
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
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <Probe />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('0');
    act(() => screen.getByTestId('probe').click());
    expect(screen.getByTestId('probe').textContent).toBe('1');
  });
});

// ── Iteration 6.16.3: state machine ─────────────────────────────────────────
describe('UIStatusContext — nprogress-style state machine', () => {
  it('startNavigation() puts phase=pending; bar invisible until 100 ms elapse', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
      ),
    });
    expect(result.current.visible).toBe(false);
    act(() => {
      result.current.startNavigation();
    });
    // Pending — visible flag is true (phase != idle), but bar is in pending
    // phase with progress=0. Per the React state machine the visibility
    // flag flips ON entering pending so the DOM exists; the user only
    // perceives the bar after the 100 ms debounce since progress remains 0.
    // We assert progress stays 0 before the timer fires.
    expect(result.current.progress).toBe(0);
    act(() => {
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS - 10);
    });
    expect(result.current.progress).toBe(0);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    // Now in progressing phase — the RAF loop will tick progress > 0.
    expect(result.current.visible).toBe(true);
  });

  it('endNavigation() before 100 ms: phase returns to idle; bar never showed', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
      ),
    });
    act(() => {
      result.current.startNavigation();
    });
    act(() => {
      vi.advanceTimersByTime(50); // less than the 100 ms debounce
      result.current.endNavigation();
    });
    expect(result.current.visible).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it('endNavigation() mid-progressing: snaps to 100, then fades to idle after NAV_FADE_OUT_MS', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
      ),
    });
    act(() => {
      result.current.startNavigation();
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(result.current.visible).toBe(true);
    act(() => {
      result.current.endNavigation();
    });
    expect(result.current.progress).toBe(100);
    expect(result.current.visible).toBe(true);
    act(() => {
      vi.advanceTimersByTime(NAV_FADE_OUT_MS + 10);
    });
    expect(result.current.visible).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it('pathname change auto-fires endNavigation()', () => {
    pathnameMock.mockReturnValue('/start');
    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    const { rerender } = render(
      <UIStatusProvider disableClickInterception>
        <Capture />
      </UIStatusProvider>,
    );
    act(() => {
      apiRef.current?.startNavigation();
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(apiRef.current?.visible).toBe(true);
    // Now pathname changes — auto-end fires.
    pathnameMock.mockReturnValue('/next');
    act(() => {
      rerender(
        <UIStatusProvider disableClickInterception>
          <Capture />
        </UIStatusProvider>,
      );
    });
    expect(apiRef.current?.progress).toBe(100);
    act(() => {
      vi.advanceTimersByTime(NAV_FADE_OUT_MS + 10);
    });
    expect(apiRef.current?.visible).toBe(false);
  });

  it('searchParams-only change does NOT end navigation', () => {
    pathnameMock.mockReturnValue('/static');
    searchParamsMock.mockReturnValue(new URLSearchParams('?q=a'));
    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    const { rerender } = render(
      <UIStatusProvider disableClickInterception>
        <Capture />
      </UIStatusProvider>,
    );
    act(() => {
      apiRef.current?.startNavigation();
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    searchParamsMock.mockReturnValue(new URLSearchParams('?q=b'));
    act(() => {
      rerender(
        <UIStatusProvider disableClickInterception>
          <Capture />
        </UIStatusProvider>,
      );
    });
    // Navigation is still in flight — progress is NOT 100 yet.
    expect(apiRef.current?.progress).toBeLessThan(100);
    expect(apiRef.current?.visible).toBe(true);
  });

  it('30 s safety timeout forces the bar to close on stuck navigation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
      ),
    });
    act(() => {
      result.current.startNavigation();
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(result.current.visible).toBe(true);
    // Simulate aborted navigation — neither endNavigation nor pathname change.
    act(() => {
      vi.advanceTimersByTime(NAV_SAFETY_TIMEOUT_MS + 10);
    });
    // After safety timeout we entered completing → schedule fade.
    act(() => {
      vi.advanceTimersByTime(NAV_FADE_OUT_MS + 10);
    });
    expect(result.current.visible).toBe(false);
    warn.mockRestore();
  });

  it('page-scope op extends endNavigation: nav ends, but bar continues until op resolves', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
      ),
    });
    let unreg!: () => void;
    act(() => {
      result.current.startNavigation();
      unreg = result.current.registerPageOp('deep-link-fetch');
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(result.current.visible).toBe(true);
    // endNavigation called (e.g. by pathname change) but pageOp still active.
    act(() => {
      result.current.endNavigation();
    });
    // Bar must NOT complete — page op still in flight.
    expect(result.current.progress).toBeLessThan(100);
    expect(result.current.visible).toBe(true);
    // Resolve the page op.
    act(() => {
      unreg();
    });
    // Now we transition to completing.
    expect(result.current.progress).toBe(100);
    act(() => {
      vi.advanceTimersByTime(NAV_FADE_OUT_MS + 10);
    });
    expect(result.current.visible).toBe(false);
  });

  it('lone page-scope op without a navigation drives the bar (deep-link initial fetch)', () => {
    const { result } = renderHook(() => useUIStatus(), {
      wrapper: ({ children }) => (
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          {children}
        </UIStatusProvider>
      ),
    });
    let unreg!: () => void;
    act(() => {
      unreg = result.current.registerPageOp('initial');
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(result.current.visible).toBe(true);
    act(() => {
      unreg();
    });
    expect(result.current.progress).toBe(100);
    act(() => {
      vi.advanceTimersByTime(NAV_FADE_OUT_MS + 10);
    });
    expect(result.current.visible).toBe(false);
  });

  it('disablePathnameTracking prevents the auto-end on route change', () => {
    pathnameMock.mockReturnValue('/start');
    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    const { rerender } = render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <Capture />
      </UIStatusProvider>,
    );
    act(() => {
      apiRef.current?.startNavigation();
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    pathnameMock.mockReturnValue('/different');
    act(() => {
      rerender(
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          <Capture />
        </UIStatusProvider>,
      );
    });
    // No auto-end — bar still in progressing phase.
    expect(apiRef.current?.visible).toBe(true);
    expect(apiRef.current?.progress).toBeLessThan(100);
  });

  it('useLocale() change auto-fires startNavigation() (locale switcher path)', () => {
    localeMock.mockReturnValue('en');
    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    const { rerender } = render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <Capture />
      </UIStatusProvider>,
    );
    expect(apiRef.current?.visible).toBe(false);

    // Simulate the locale switcher flipping en → he.
    localeMock.mockReturnValue('he');
    act(() => {
      rerender(
        <UIStatusProvider disablePathnameTracking disableClickInterception>
          <Capture />
        </UIStatusProvider>,
      );
    });
    // Pending phase — wait the debounce.
    act(() => {
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(apiRef.current?.visible).toBe(true);
    expect(apiRef.current?.progress).toBeLessThan(100);
  });

  it('disableLocaleTracking prevents the locale-change auto-start', () => {
    localeMock.mockReturnValue('en');
    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    const { rerender } = render(
      <UIStatusProvider disablePathnameTracking disableClickInterception disableLocaleTracking>
        <Capture />
      </UIStatusProvider>,
    );
    localeMock.mockReturnValue('he');
    act(() => {
      rerender(
        <UIStatusProvider disablePathnameTracking disableClickInterception disableLocaleTracking>
          <Capture />
        </UIStatusProvider>,
      );
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(apiRef.current?.visible).toBe(false);
  });
});

// ── Click interceptor edge cases ─────────────────────────────────────────────
describe('UIStatusContext — click interception (shouldInterceptAnchorClick)', () => {
  function makeAnchor(attrs: Record<string, string>): HTMLAnchorElement {
    const a = document.createElement('a');
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    document.body.appendChild(a);
    return a;
  }
  function makeEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
    const e = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...overrides,
    });
    return e;
  }

  // Use jsdom's default location (typically http://localhost:3000/) so
  // anchor href resolution works without overriding window.location.

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('plain left-click on internal href → intercept', () => {
    const a = makeAnchor({ href: '/other' });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(true);
  });

  it('external https URL → no intercept', () => {
    const a = makeAnchor({ href: 'https://example.com/x' });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(false);
  });

  it('mailto: → no intercept', () => {
    const a = makeAnchor({ href: 'mailto:foo@bar.com' });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(false);
  });

  it('tel: → no intercept', () => {
    const a = makeAnchor({ href: 'tel:+1234567890' });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(false);
  });

  it('#hash → no intercept', () => {
    const a = makeAnchor({ href: '#section' });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(false);
  });

  it('Cmd-click → no intercept', () => {
    const a = makeAnchor({ href: '/other' });
    expect(shouldInterceptAnchorClick(makeEvent({ metaKey: true }), a)).toBe(false);
  });

  it('Ctrl-click → no intercept', () => {
    const a = makeAnchor({ href: '/other' });
    expect(shouldInterceptAnchorClick(makeEvent({ ctrlKey: true }), a)).toBe(false);
  });

  it('Shift-click → no intercept', () => {
    const a = makeAnchor({ href: '/other' });
    expect(shouldInterceptAnchorClick(makeEvent({ shiftKey: true }), a)).toBe(false);
  });

  it('middle-click (button=1) → no intercept', () => {
    const a = makeAnchor({ href: '/other' });
    expect(shouldInterceptAnchorClick(makeEvent({ button: 1 }), a)).toBe(false);
  });

  it('target="_blank" → no intercept', () => {
    const a = makeAnchor({ href: '/other', target: '_blank' });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(false);
  });

  it('e.defaultPrevented === true → no intercept', () => {
    const a = makeAnchor({ href: '/other' });
    const e = makeEvent();
    e.preventDefault();
    expect(shouldInterceptAnchorClick(e, a)).toBe(false);
  });

  it('download attribute → no intercept', () => {
    const a = makeAnchor({ href: '/file.pdf', download: '' });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(false);
  });

  it('same exact pathname+search → no intercept (no real navigation)', () => {
    // Anchor pointing at the same URL the test page is currently at —
    // the default jsdom pathname.
    const a = makeAnchor({ href: window.location.pathname + window.location.search });
    expect(shouldInterceptAnchorClick(makeEvent(), a)).toBe(false);
  });

  it('document-level handler triggers startNavigation on a real DOM click on a nested element', () => {
    const a = document.createElement('a');
    a.setAttribute('href', '/nested-target');
    const span = document.createElement('span');
    span.textContent = 'click me';
    a.appendChild(span);
    document.body.appendChild(a);

    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    render(
      <UIStatusProvider disablePathnameTracking>
        <Capture />
      </UIStatusProvider>,
    );

    expect(apiRef.current?.visible).toBe(false);
    // Dispatch a click directly on the nested span; the closest('a[href]')
    // lookup finds the anchor.
    act(() => {
      span.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });
    // Now the state machine is in pending phase.
    expect(apiRef.current?.progress).toBe(0);
    act(() => {
      vi.advanceTimersByTime(NAV_VISIBILITY_DEBOUNCE_MS + 20);
    });
    expect(apiRef.current?.visible).toBe(true);
  });
});
