import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryReturnDialog } from './RetryReturnDialog';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string>) => {
    const ns = namespace ? `${namespace}.` : '';
    if (values && 'status' in values) {
      return `${ns}${key}:${values.status}`;
    }
    return `${ns}${key}`;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RetryReturnDialog', () => {
  it('renders nothing when open=false', () => {
    render(
      <RetryReturnDialog open={false} reason="timeout" onRetry={vi.fn()} onReturn={vi.fn()} />,
    );
    expect(screen.queryByTestId('retry-return-dialog')).not.toBeInTheDocument();
  });

  it('renders an alertdialog with role + aria-modal when open=true', () => {
    render(<RetryReturnDialog open reason="timeout" onRetry={vi.fn()} onReturn={vi.fn()} />);
    const dialog = screen.getByTestId('retry-return-dialog');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('retry-return-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('retry-return-dialog-message');
  });

  it('reason="timeout" surfaces the timeout message via i18n', () => {
    render(<RetryReturnDialog open reason="timeout" onRetry={vi.fn()} onReturn={vi.fn()} />);
    expect(screen.getByTestId('retry-return-dialog-message').textContent).toContain(
      'messages.timeout',
    );
  });

  it('reason="http" with httpStatus interpolates the status code', () => {
    render(
      <RetryReturnDialog
        open
        reason="http"
        httpStatus={500}
        onRetry={vi.fn()}
        onReturn={vi.fn()}
      />,
    );
    expect(screen.getByTestId('retry-return-dialog-message').textContent).toContain('500');
  });

  it('Retry button is auto-focused on open', async () => {
    render(<RetryReturnDialog open reason="network" onRetry={vi.fn()} onReturn={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(document.activeElement).toBe(screen.getByTestId('retry-return-dialog-retry'));
  });

  it('clicking Retry invokes onRetry', () => {
    const onRetry = vi.fn();
    render(
      <RetryReturnDialog
        open
        reason="network"
        onRetry={onRetry}
        onReturn={vi.fn()}
        autoRetryMs={0}
      />,
    );
    fireEvent.click(screen.getByTestId('retry-return-dialog-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('clicking Return invokes onReturn', () => {
    const onReturn = vi.fn();
    render(
      <RetryReturnDialog
        open
        reason="network"
        onRetry={vi.fn()}
        onReturn={onReturn}
        autoRetryMs={0}
      />,
    );
    fireEvent.click(screen.getByTestId('retry-return-dialog-return'));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('pressing ESC invokes onReturn', () => {
    const onReturn = vi.fn();
    render(
      <RetryReturnDialog
        open
        reason="network"
        onRetry={vi.fn()}
        onReturn={onReturn}
        autoRetryMs={0}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop invokes onReturn', () => {
    const onReturn = vi.fn();
    render(
      <RetryReturnDialog
        open
        reason="network"
        onRetry={vi.fn()}
        onReturn={onReturn}
        autoRetryMs={0}
      />,
    );
    fireEvent.click(screen.getByTestId('retry-return-dialog-backdrop'));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('auto-retry: invokes onRetry after the configured timeout', () => {
    const onRetry = vi.fn();
    render(
      <RetryReturnDialog
        open
        reason="timeout"
        onRetry={onRetry}
        onReturn={vi.fn()}
        autoRetryMs={500}
      />,
    );
    expect(onRetry).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('auto-retry can be disabled with autoRetryMs=0; no countdown bar rendered', () => {
    render(
      <RetryReturnDialog
        open
        reason="timeout"
        onRetry={vi.fn()}
        onReturn={vi.fn()}
        autoRetryMs={0}
      />,
    );
    expect(screen.queryByTestId('retry-return-dialog-countdown')).not.toBeInTheDocument();
  });
});
