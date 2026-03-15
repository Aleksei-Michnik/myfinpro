import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider, ToastContainer, useToast } from './Toast';

// Test helper component to trigger toast actions
function ToastTrigger() {
  const { addToast, removeToast, toasts } = useToast();
  return (
    <div>
      <button onClick={() => addToast('success', 'Success message')}>Add Success</button>
      <button onClick={() => addToast('error', 'Error message')}>Add Error</button>
      <button onClick={() => addToast('warning', 'Warning message')}>Add Warning</button>
      <button onClick={() => addToast('info', 'Info message')}>Add Info</button>
      <button onClick={() => addToast('success', 'Quick toast', 100)}>Add Quick</button>
      {toasts.length > 0 && <button onClick={() => removeToast(toasts[0].id)}>Remove First</button>}
      <span data-testid="toast-count">{toasts.length}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <ToastTrigger />
      <ToastContainer />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without toasts initially', () => {
    renderWithProvider();
    expect(screen.getByTestId('toast-count')).toHaveTextContent('0');
    expect(screen.queryByTestId('toast-container')).not.toBeInTheDocument();
  });

  it('adds a success toast with correct styling', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Success').click();
    });
    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    expect(screen.getByText('Success message')).toBeInTheDocument();
    expect(screen.getByTestId('toast-count')).toHaveTextContent('1');
  });

  it('adds an error toast', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Error').click();
    });
    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    expect(screen.getByText('Error message')).toBeInTheDocument();
  });

  it('adds a warning toast', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Warning').click();
    });
    expect(screen.getByTestId('toast-warning')).toBeInTheDocument();
    expect(screen.getByText('Warning message')).toBeInTheDocument();
  });

  it('adds an info toast', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Info').click();
    });
    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
    expect(screen.getByText('Info message')).toBeInTheDocument();
  });

  it('auto-dismisses after duration', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Quick').click();
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('1');

    // Advance timers past the 100ms duration
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByTestId('toast-count')).toHaveTextContent('0');
  });

  it('manual dismiss via button', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Success').click();
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('1');

    act(() => {
      screen.getByTestId('toast-dismiss').click();
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('0');
  });

  it('multiple toasts stack', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Success').click();
      screen.getByText('Add Error').click();
      screen.getByText('Add Warning').click();
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('3');
    expect(screen.getByTestId('toast-container')).toBeInTheDocument();
  });

  it('limits to max 5 visible toasts', () => {
    renderWithProvider();
    act(() => {
      for (let i = 0; i < 7; i++) {
        screen.getByText('Add Success').click();
      }
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('5');
  });

  it('removeToast works correctly', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Success').click();
      screen.getByText('Add Error').click();
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('2');

    act(() => {
      screen.getByText('Remove First').click();
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('1');
  });

  it('toast has role="alert" for accessibility', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Success').click();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('dismiss button has accessible label', () => {
    renderWithProvider();
    act(() => {
      screen.getByText('Add Success').click();
    });
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
  });

  it('throws when useToast is used outside ToastProvider', () => {
    function BadConsumer() {
      try {
        useToast();
        return <div>no error</div>;
      } catch (err) {
        return <div data-testid="error">{(err as Error).message}</div>;
      }
    }

    render(<BadConsumer />);
    expect(screen.getByTestId('error')).toHaveTextContent(
      'useToast must be used within a ToastProvider',
    );
  });
});
