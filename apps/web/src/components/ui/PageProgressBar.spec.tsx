import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageProgressBar } from './PageProgressBar';
import { UIStatusProvider, useUIStatus } from '@/lib/ui';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => `ui.loading.${k}`,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

function Toggle({ children }: { children: React.ReactNode }) {
  // Auxiliary component used to drive the registerPageOp from inside a test.
  return <>{children}</>;
}

describe('PageProgressBar', () => {
  it('is hidden when activePageOps === 0', () => {
    render(
      <UIStatusProvider disablePathnameTracking>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('page-progress-bar').hasAttribute('hidden')).toBe(true);
    expect(screen.getByTestId('page-progress-bar').getAttribute('data-active')).toBe('false');
  });

  it('becomes visible when at least one page-scope op is active', () => {
    let registerFn: ((id: string) => () => void) | null = null;
    function Capture() {
      const { registerPageOp } = useUIStatus();
      registerFn = registerPageOp;
      return null;
    }
    render(
      <UIStatusProvider disablePathnameTracking>
        <Toggle>
          <Capture />
          <PageProgressBar />
        </Toggle>
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('page-progress-bar').hasAttribute('hidden')).toBe(true);
    act(() => {
      registerFn?.('a');
    });
    expect(screen.getByTestId('page-progress-bar').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('page-progress-bar').getAttribute('data-active')).toBe('true');
  });

  it('exposes role="progressbar" with indeterminate semantics (no aria-valuenow)', () => {
    render(
      <UIStatusProvider disablePathnameTracking>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    const bar = screen.getByTestId('page-progress-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('uses the i18n-resolved aria-label from ui.loading.pageProgressLabel', () => {
    render(
      <UIStatusProvider disablePathnameTracking>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('page-progress-bar').getAttribute('aria-label')).toBe(
      'ui.loading.pageProgressLabel',
    );
  });

  it('the inner fill has the mfp-progress-bar class so reduced-motion CSS targets it', () => {
    render(
      <UIStatusProvider disablePathnameTracking>
        <PageProgressBar />
      </UIStatusProvider>,
    );
    expect(screen.getByTestId('page-progress-bar-fill').className).toContain('mfp-progress-bar');
  });
});
