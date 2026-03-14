import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// Component that throws an error
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div data-testid="child">Normal content</div>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    // Suppress console.error during error boundary tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('shows fallback UI on error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument();
  });

  it('shows "Try Again" button in fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-reset')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-reset')).toHaveTextContent('Try Again');
  });

  it('reset button clears error state and re-renders children', () => {
    // Use a mutable flag so the same component instance can stop throwing
    let shouldThrowFlag = true;
    function ConditionalThrower() {
      if (shouldThrowFlag) {
        throw new Error('Test error');
      }
      return <div data-testid="child">Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    // Should show error boundary
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();

    // Stop throwing, then click reset
    shouldThrowFlag = false;
    fireEvent.click(screen.getByTestId('error-boundary-reset'));

    // Now children should render successfully
    expect(screen.getByTestId('child')).toHaveTextContent('Recovered');
  });

  it('renders custom fallback when provided', () => {
    const customFallback = <div data-testid="custom-fallback">Custom error UI</div>;

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.getByText('Custom error UI')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
  });

  it('logs error to console', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('fallback has role="alert" for accessibility', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
