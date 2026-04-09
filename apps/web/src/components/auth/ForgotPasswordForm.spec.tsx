import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForgotPasswordForm } from './ForgotPasswordForm';

const mockPost = vi.fn();
const mockAddToast = vi.fn();

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock @/i18n/navigation
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

// Mock Toast
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email input and submit button', () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByLabelText('email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sendResetLink' })).toBeInTheDocument();
  });

  it('validates email is required', async () => {
    render(<ForgotPasswordForm />);
    const emailInput = screen.getByLabelText('email');
    fireEvent.blur(emailInput);
    expect(screen.getByText('emailRequired')).toBeInTheDocument();
  });

  it('submits email and shows check-email state on success', async () => {
    mockPost.mockResolvedValueOnce({});
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', {
        email: 'test@example.com',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('check-email-state')).toBeInTheDocument();
    });
    expect(screen.getByText('checkYourEmail')).toBeInTheDocument();
    expect(screen.getByText('resetLinkSent')).toBeInTheDocument();
  });

  it('shows error toast on network failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network error'));
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'networkError');
    });
  });

  it('shows loading state while submitting', async () => {
    let resolvePost: (value: unknown) => void;
    mockPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sendingResetLink' })).toBeDisabled();
    });

    resolvePost!({});
  });

  it('has link back to sign in', () => {
    render(<ForgotPasswordForm />);
    const link = screen.getByText('backToSignIn');
    expect(link.closest('a')).toHaveAttribute('href', '/auth/login');
  });

  it('has link back to sign in in sent state', async () => {
    mockPost.mockResolvedValueOnce({});
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));

    await waitFor(() => {
      expect(screen.getByTestId('check-email-state')).toBeInTheDocument();
    });

    const link = screen.getByText('backToSignIn');
    expect(link.closest('a')).toHaveAttribute('href', '/auth/login');
  });
});
