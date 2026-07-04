import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingOverlay } from './LoadingOverlay';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LoadingOverlay', () => {
  it('does not render when active=false', () => {
    render(<LoadingOverlay active={false} />);
    expect(screen.queryByTestId('loading-overlay')).not.toBeInTheDocument();
  });

  it('renders only after the 150 ms debounce when active becomes true', () => {
    const { rerender } = render(<LoadingOverlay active={false} />);
    rerender(<LoadingOverlay active={true} />);
    expect(screen.queryByTestId('loading-overlay')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(screen.queryByTestId('loading-overlay')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByTestId('loading-overlay')).toBeInTheDocument();
  });

  it('hides immediately when active flips back to false', () => {
    const { rerender } = render(<LoadingOverlay active={true} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId('loading-overlay')).toBeInTheDocument();
    rerender(<LoadingOverlay active={false} />);
    expect(screen.queryByTestId('loading-overlay')).not.toBeInTheDocument();
  });

  it('exposes role="status", aria-live="polite", aria-busy="true"', () => {
    render(<LoadingOverlay active={true} delayMs={0} />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const root = screen.getByTestId('loading-overlay');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the custom message visibly + as a visually-hidden duplicate for AT', () => {
    render(<LoadingOverlay active={true} delayMs={0} message="Refreshing payments…" />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('loading-overlay-message')).toHaveTextContent('Refreshing payments…');
    // Total occurrences (visible + sr-only) = 2.
    const overlay = screen.getByTestId('loading-overlay');
    expect(overlay.textContent?.match(/Refreshing payments…/g)?.length).toBe(2);
  });

  it('swallows clicks so they do not reach the parent', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <LoadingOverlay active={true} delayMs={0} />
      </div>,
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.click(screen.getByTestId('loading-overlay'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
