import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsyncHttpError } from './async-operation';
import { UIStatusProvider, useUIStatus } from './ui-status-context';
import { useAsyncOperation } from './use-async-operation';

// next/navigation is referenced by UIStatusProvider for the pathname flash;
// stub minimal implementations so the provider can mount in tests.
vi.mock('next/navigation', () => ({
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('useAsyncOperation', () => {
  it('initial state is idle with no data and no error', () => {
    const { result } = renderHook(() => useAsyncOperation<number>({ scope: 'container' }));
    expect(result.current.isIdle).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.phase.kind).toBe('idle');
  });

  it('run() transitions idle → loading → success and returns the data', async () => {
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const op = vi.fn().mockResolvedValue('hello');
    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.run(op);
    });
    expect(returned).toBe('hello');
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toBe('hello');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('network error: phase becomes error with reason="network"; promise resolves undefined', async () => {
    const { result } = renderHook(() => useAsyncOperation<number>({ scope: 'container' }));
    const op = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    let returned: number | undefined = 7;
    await act(async () => {
      returned = await result.current.run(op);
    });
    expect(returned).toBeUndefined();
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.reason).toBe('network');
  });

  it('AsyncHttpError → reason="http", httpStatus carried', async () => {
    const { result } = renderHook(() => useAsyncOperation<number>({ scope: 'container' }));
    const op = vi.fn().mockRejectedValue(new AsyncHttpError(500, 'boom'));
    await act(async () => {
      await result.current.run(op);
    });
    expect(result.current.error?.reason).toBe('http');
    expect(result.current.error?.httpStatus).toBe(500);
  });

  it('Error with .status property is classified as http', async () => {
    const { result } = renderHook(() => useAsyncOperation<number>({ scope: 'container' }));
    const err = Object.assign(new Error('Bad request'), { status: 400 });
    const op = vi.fn().mockRejectedValue(err);
    await act(async () => {
      await result.current.run(op);
    });
    expect(result.current.error?.reason).toBe('http');
    expect(result.current.error?.httpStatus).toBe(400);
  });

  it('timeout: classifies as reason="timeout" and aborts the signal', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));

    const captured: { signal: AbortSignal | null } = { signal: null };
    const op = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        captured.signal = signal;
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });

    let runPromise: Promise<string | undefined> | undefined;
    act(() => {
      runPromise = result.current.run(op, { timeoutMs: 100 });
    });

    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => {
      await runPromise;
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.error?.reason).toBe('timeout');
    expect(captured.signal?.aborted).toBe(true);
  });

  it('successful run within timeout clears the timer (no late timeout firing)', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const op = vi.fn().mockResolvedValue('ok');
    await act(async () => {
      await result.current.run(op, { timeoutMs: 1000 });
    });
    expect(result.current.isSuccess).toBe(true);
    // Advance well beyond the timeout — phase must remain 'success'.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('a second run() mid-loading aborts the first', async () => {
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const captured: { signal: AbortSignal | null } = { signal: null };
    const slow = (signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        captured.signal = signal;
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        // Never resolves on its own.
        void resolve;
      });
    const fast = vi.fn().mockResolvedValue('done');
    let firstPromise: Promise<string | undefined> | undefined;
    act(() => {
      firstPromise = result.current.run(slow);
    });
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      await result.current.run(fast);
    });
    expect(captured.signal?.aborted).toBe(true);
    expect(result.current.data).toBe('done');
    // The first promise resolves with undefined (superseded) — ensure no pending warnings.
    await act(async () => {
      await firstPromise;
    });
  });

  it('retry() re-issues the last op with the retry timeout', async () => {
    const { result } = renderHook(() =>
      useAsyncOperation<number>({ scope: 'container', retryTimeoutMs: 9999 }),
    );
    const op = vi.fn().mockRejectedValueOnce(new TypeError('net')).mockResolvedValueOnce(42);
    await act(async () => {
      await result.current.run(op);
    });
    expect(result.current.isError).toBe(true);
    await act(async () => {
      await result.current.retry();
    });
    expect(op).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(42);
    expect(result.current.isSuccess).toBe(true);
  });

  it('retry() resolves undefined when no op was ever recorded', async () => {
    const { result } = renderHook(() => useAsyncOperation<number>({ scope: 'container' }));
    let r: number | undefined;
    await act(async () => {
      r = await result.current.retry();
    });
    expect(r).toBeUndefined();
    expect(result.current.isIdle).toBe(true);
  });

  it('cancel() returns to idle WITHOUT clearing previously-successful data', async () => {
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const ok = vi.fn().mockResolvedValue('first');
    await act(async () => {
      await result.current.run(ok);
    });
    expect(result.current.data).toBe('first');
    // Start a new run, then cancel mid-flight.
    const slow = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    let p: Promise<string | undefined> | undefined;
    act(() => {
      p = result.current.run(slow);
    });
    expect(result.current.isLoading).toBe(true);
    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      await p;
    });
    expect(result.current.isIdle).toBe(true);
    expect(result.current.data).toBe('first');
  });

  it('reset() clears data and error', async () => {
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const ok = vi.fn().mockResolvedValue('val');
    await act(async () => {
      await result.current.run(ok);
    });
    expect(result.current.data).toBe('val');
    act(() => {
      result.current.reset();
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isIdle).toBe(true);
  });

  it('previousData is preserved across an error after a success', async () => {
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const ok = vi.fn().mockResolvedValue('cached');
    const fail = vi.fn().mockRejectedValue(new TypeError('net'));
    await act(async () => {
      await result.current.run(ok);
    });
    await act(async () => {
      await result.current.run(fail);
    });
    expect(result.current.isError).toBe(true);
    // `data` continues to surface the previous successful value.
    expect(result.current.data).toBe('cached');
  });

  it('page-scope op registers + unregisters with the bus', async () => {
    let lastCount = 0;
    function CounterReader() {
      lastCount = useUIStatus().activePageOps;
      return null;
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <UIStatusProvider disablePathnameTracking>
        <CounterReader />
        {children}
      </UIStatusProvider>
    );
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'page' }), {
      wrapper,
    });
    const slow = (signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => resolve('aborted'));
        setTimeout(() => resolve('ok'), 10);
      });
    let p: Promise<string | undefined> | undefined;
    act(() => {
      p = result.current.run(slow);
    });
    await waitFor(() => expect(lastCount).toBe(1));
    await act(async () => {
      await p;
    });
    await waitFor(() => expect(lastCount).toBe(0));
  });

  it('multiple hooks coexist; each manages its own controller independently', async () => {
    const { result: a } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const { result: b } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const captured: { signal: AbortSignal | null } = { signal: null };
    const slow = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        captured.signal = signal;
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    let aPromise: Promise<string | undefined> | undefined;
    act(() => {
      aPromise = a.current.run(slow);
    });
    await act(async () => {
      await b.current.run(vi.fn().mockResolvedValue('B-done'));
    });
    expect(b.current.data).toBe('B-done');
    // A is still loading independently.
    expect(a.current.isLoading).toBe(true);
    expect(captured.signal?.aborted).toBe(false);
    act(() => {
      a.current.cancel();
    });
    await act(async () => {
      await aPromise;
    });
  });

  it('unmount aborts in-flight without warnings and cleans up', async () => {
    const { result, unmount } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const captured: { signal: AbortSignal | null } = { signal: null };
    const slow = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        captured.signal = signal;
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    let p: Promise<string | undefined> | undefined;
    act(() => {
      p = result.current.run(slow);
    });
    expect(result.current.isLoading).toBe(true);
    unmount();
    expect(captured.signal?.aborted).toBe(true);
    await p; // resolves undefined, no thrown errors.
  });

  it('explicit timeoutMs on run() overrides the per-scope default', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const slow = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    let p: Promise<string | undefined> | undefined;
    act(() => {
      p = result.current.run(slow, { timeoutMs: 50 });
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    await act(async () => {
      await p;
    });
    expect(result.current.error?.reason).toBe('timeout');
  });

  it('uses the per-scope default timeout when none is provided on run()', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useAsyncOperation<string>({ scope: 'container', defaultTimeoutMs: 200 }),
    );
    const slow = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    let p: Promise<string | undefined> | undefined;
    act(() => {
      p = result.current.run(slow);
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      await p;
    });
    expect(result.current.error?.reason).toBe('timeout');
  });

  it('custom id is preserved on the loading phase pendingId', async () => {
    const { result } = renderHook(() =>
      useAsyncOperation<string>({ scope: 'container', id: 'my-fixed-id' }),
    );
    const slow = (signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => resolve('a'));
      });
    act(() => {
      void result.current.run(slow);
    });
    expect(result.current.phase.kind).toBe('loading');
    if (result.current.phase.kind === 'loading') {
      expect(result.current.phase.pendingId).toBe('my-fixed-id');
    }
    act(() => {
      result.current.cancel();
    });
  });

  it('aborted via cancel() resolves with undefined and isIdle stays true', async () => {
    const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
    const slow = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    let p: Promise<string | undefined> | undefined;
    act(() => {
      p = result.current.run(slow);
    });
    act(() => {
      result.current.cancel();
    });
    let res: string | undefined = 'unset';
    await act(async () => {
      res = await p;
    });
    expect(res).toBeUndefined();
    expect(result.current.isIdle).toBe(true);
  });

  describe('AbortError silent no-op (6.16.5)', () => {
    it('AbortError thrown outside cancel/unmount → phase returns to idle, no error', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
      const op = vi.fn().mockRejectedValue(new DOMException('aborted by caller', 'AbortError'));
      let returned: string | undefined = 'unset';
      await act(async () => {
        returned = await result.current.run(op);
      });
      expect(returned).toBeUndefined();
      // Critically: NOT in error state — the previous "error" classification
      // surfaced the AbortError as a user-visible "no access" banner.
      expect(result.current.isError).toBe(false);
      expect(result.current.isIdle).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('plain object with name="AbortError" is also silent', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
      const op = vi.fn().mockRejectedValue({ name: 'AbortError', message: 'aborted' });
      await act(async () => {
        await result.current.run(op);
      });
      expect(result.current.isError).toBe(false);
      expect(result.current.isIdle).toBe(true);
    });

    it('previousData is preserved across a silent abort following a successful run', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
      const ok = vi.fn().mockResolvedValue('cached-value');
      const aborted = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
      await act(async () => {
        await result.current.run(ok);
      });
      expect(result.current.data).toBe('cached-value');
      await act(async () => {
        await result.current.run(aborted);
      });
      expect(result.current.isIdle).toBe(true);
      // Data is still surfaced from the previous successful run.
      expect(result.current.data).toBe('cached-value');
    });

    it('timeout-triggered abort still classifies as timeout (regression guard)', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useAsyncOperation<string>({ scope: 'container' }));
      const slow = (signal: AbortSignal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      let p: Promise<string | undefined> | undefined;
      act(() => {
        p = result.current.run(slow, { timeoutMs: 50 });
      });
      await act(async () => {
        vi.advanceTimersByTime(70);
      });
      await act(async () => {
        await p;
      });
      expect(result.current.error?.reason).toBe('timeout');
    });
  });
});
