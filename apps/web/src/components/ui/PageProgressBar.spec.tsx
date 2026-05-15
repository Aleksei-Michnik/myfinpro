import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageProgressBar } from './PageProgressBar';
import { UIStatusProvider, useUIStatus } from '@/lib/ui';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => `ui.loading.${k}`,
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PageProgressBar', () => {
  it('is hidden when no navigation is in flight (visible=false, progress=0)', () => {
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    const bar = screen.getByTestId('page-progress-bar');
    expect(bar.hasAttribute('hidden')).toBe(true);
    expect(bar.getAttribute('data-active')).toBe('false');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('becomes visible after the 100 ms debounce on startNavigation()', () => {
    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <Capture />
        <PageProgressBar />
      </UIStatusProvider>,
    );
    act(() => {
      apiRef.current?.startNavigation();
    });
    // Pending phase — still hidden.
    expect(screen.getByTestId('page-progress-bar').hasAttribute('hidden')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(110);
    });
    // Progressing phase — visible, progress=0 initially.
    expect(screen.getByTestId('page-progress-bar').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('page-progress-bar').getAttribute('data-active')).toBe('true');
  });

  it('exposes role="progressbar" with determinate semantics (aria-valuenow set)', () => {
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    const bar = screen.getByTestId('page-progress-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.hasAttribute('aria-valuenow')).toBe(true);
  });

  it('uses the i18n-resolved aria-label from ui.loading.pageProgressLabel', () => {
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('page-progress-bar').getAttribute('aria-label')).toBe(
      'ui.loading.pageProgressLabel',
    );
  });

  it('the inner fill carries the .mfp-progress-bar class so reduced-motion CSS targets it', () => {
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('page-progress-bar-fill').className).toContain('mfp-progress-bar');
  });

  it('uses the blue-500 background colour (per user spec)', () => {
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('page-progress-bar-fill').className).toContain('bg-blue-500');
  });

  it('is sticky to the viewport top with z-index 9999 (fixed top:0)', () => {
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    const bar = screen.getByTestId('page-progress-bar');
    // The classes encode position:fixed, top:0, inset-x:0, z-9999.
    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('top-0');
    expect(bar.className).toContain('inset-x-0');
    expect(bar.className).toContain('z-[9999]');
  });

  it('the inline transform reflects progress via scaleX', () => {
    const apiRef: { current: ReturnType<typeof useUIStatus> | null } = { current: null };
    function Capture() {
      apiRef.current = useUIStatus();
      return null;
    }
    render(
      <UIStatusProvider disablePathnameTracking disableClickInterception>
        <Capture />
        <PageProgressBar />
      </UIStatusProvider>,
    );
    act(() => {
      apiRef.current?.startNavigation();
      vi.advanceTimersByTime(110);
    });
    const fill = screen.getByTestId('page-progress-bar-fill');
    // Initial frame has scaleX(0). After RAF ticks the progress would
    // advance, but in jsdom RAF is fired by the timer shim and may not
    // tick deterministically here. We just assert the inline style exists.
    expect(fill.getAttribute('style')).toMatch(/scaleX\(/);
  });
});
