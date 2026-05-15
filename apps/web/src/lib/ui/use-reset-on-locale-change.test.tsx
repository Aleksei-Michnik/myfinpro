import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useResetOnLocaleChange } from './use-reset-on-locale-change';

const localeMock = vi.fn(() => 'en');
vi.mock('next-intl', () => ({
  useLocale: () => localeMock(),
}));

describe('useResetOnLocaleChange (Phase 6 · Iteration 6.16.5)', () => {
  it('does NOT call the callback on initial mount', () => {
    localeMock.mockReturnValue('en');
    const cb = vi.fn();
    renderHook(() => useResetOnLocaleChange(cb));
    expect(cb).not.toHaveBeenCalled();
  });

  it('calls the callback exactly once when the locale changes', () => {
    localeMock.mockReturnValue('en');
    const cb = vi.fn();
    const { rerender } = renderHook(() => useResetOnLocaleChange(cb));
    expect(cb).not.toHaveBeenCalled();

    localeMock.mockReturnValue('he');
    act(() => {
      rerender();
    });
    expect(cb).toHaveBeenCalledTimes(1);

    // Stable across re-renders with the same locale.
    act(() => {
      rerender();
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('reads the latest callback (no stale-closure bug)', () => {
    localeMock.mockReturnValue('en');
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = renderHook(({ fn }) => useResetOnLocaleChange(fn), {
      initialProps: { fn: a },
    });
    // Swap the callback before the locale change.
    rerender({ fn: b });
    localeMock.mockReturnValue('he');
    act(() => {
      rerender({ fn: b });
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('fires again on a second locale change (en → he → en)', () => {
    localeMock.mockReturnValue('en');
    const cb = vi.fn();
    const { rerender } = renderHook(() => useResetOnLocaleChange(cb));

    localeMock.mockReturnValue('he');
    act(() => rerender());
    expect(cb).toHaveBeenCalledTimes(1);

    localeMock.mockReturnValue('en');
    act(() => rerender());
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
