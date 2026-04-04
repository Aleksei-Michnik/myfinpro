import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResetPasswordForm } from './ResetPasswordForm';

const mockPost = vi.fn();

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

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders password fields and submit button', () => {
    render(<ResetPasswordForm token="test-token" />);
    expect(screen.getByLabelText('newPassword')).toBeInTheDocument();
    expect(screen.getByLabelText('confirmPassword')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'resetPassword' })).toBeInTheDocument();
  });

  it('validates passwords match', async () => {
    render(<ResetPasswordForm token="test-token" />);

    fireEvent.change(screen.getByLabelText('newPassword'), {
      target: { value: 'Password1' },
    });
    fireEvent.change(screen.getByLabelText('confirmPassword'), {
      target: { value: 'Different1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'resetPassword' }));

    await waitFor(() => {
      expect(screen.getByText('passwordMismatch')).toBeInTheDocument();
    });
  });

  it('shows password strength indicator', () => {
    render(<ResetPasswordForm token="test-token" />);

    fireEvent.change(screen.getByLabelText('newPassword'), {
      target: { value: 'Ab1' },
    });

    expect(screen.getByTestId('password-strength')).toBeInTheDocument();
  });

  it('shows success state after successful reset', async () => {
    mockPost.mockResolvedValueOnce({});
    render(<ResetPasswordForm token="test-token" />);

    fireEvent.change(screen.getByLabelText('newPassword'), {
      target: { value: 'Password1' },
    });
    fireEvent.change(screen.getByLabelText('confirmPassword'), {
      target: { value: 'Password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'resetPassword' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
        token: 'test-token',
        password: 'Password1',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('reset-success-state')).toBeInTheDocument();
    });
    expect(screen.getByText('resetPasswordSuccess')).toBeInTheDocument();
    expect(screen.getByText('goToSignIn')).toBeInTheDocument();
  });

  it('shows expired error when token is expired', async () => {
    mockPost.mockRejectedValueOnce(new Error('AUTH_RESET_TOKEN_EXPIRED'));
    render(<ResetPasswordForm token="expired-token" />);

    fireEvent.change(screen.getByLabelText('newPassword'), {
      target: { value: 'Password1' },
    });
    fireEvent.change(screen.getByLabelText('confirmPassword'), {
      target: { value: 'Password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'resetPassword' }));

    await waitFor(() => {
      expect(screen.getByTestId('reset-error-state')).toBeInTheDocument();
    });
    expect(screen.getByText('resetPasswordExpired')).toBeInTheDocument();
    expect(screen.getByText('requestNewLink')).toBeInTheDocument();
  });

  it('shows invalid error when token is invalid', async () => {
    mockPost.mockRejectedValueOnce(new Error('AUTH_RESET_TOKEN_INVALID'));
    render(<ResetPasswordForm token="bad-token" />);

    fireEvent.change(screen.getByLabelText('newPassword'), {
      target: { value: 'Password1' },
    });
    fireEvent.change(screen.getByLabelText('confirmPassword'), {
      target: { value: 'Password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'resetPassword' }));

    await waitFor(() => {
      expect(screen.getByTestId('reset-error-state')).toBeInTheDocument();
    });
    expect(screen.getByText('resetPasswordInvalid')).toBeInTheDocument();
  });
});
