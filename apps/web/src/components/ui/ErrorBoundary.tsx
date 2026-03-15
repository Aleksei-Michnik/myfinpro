'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console (can be replaced with error reporting service later)
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-lg bg-gray-50 p-8 text-center"
          role="alert"
          data-testid="error-boundary-fallback"
        >
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
          <p className="text-sm text-gray-600">An unexpected error occurred. Please try again.</p>
          {process.env.NODE_ENV !== 'production' && this.state.error && (
            <pre className="mt-2 max-w-full overflow-auto rounded bg-red-50 p-3 text-left text-xs text-red-800">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            data-testid="error-boundary-reset"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
