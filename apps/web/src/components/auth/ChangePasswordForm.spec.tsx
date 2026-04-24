import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChangePasswordForm } from './ChangePasswordForm';

const mockChangePassword = vi.fn();
const mockAddToast = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    changePassword: mockChangePassword,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all three password fields and submit button', () => {
    render(<ChangePasswordForm />);
    expect(screen.getByLabelText('currentPasswordLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('newPasswordLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('confirmPasswordLabel')).toBeInTheDocument();
    expect(screen.getByTestId('change-password-submit')).toBeInTheDocument();
  });

  it('password fields should be type=password', () => {
    render(<ChangePasswordForm />);
    expect(screen.getByLabelText('currentPasswordLabel')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('newPasswordLabel')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('confirmPasswordLabel')).toHaveAttribute('type', 'password');
  });

  it('submit button is disabled when fields are empty', () => {
    render(<ChangePasswordForm />);
    expect(screen.getByTestId('change-password-submit')).toBeDisabled();
  });

  it('shows password strength indicator when typing a new password', () => {
    render(<ChangePasswordForm />);
    fireEvent.change(screen.getByLabelText('newPasswordLabel'), {
      target: { value: 'Ab1xxxxx' },
    });
    expect(screen.getByTestId('password-strength')).toBeInTheDocument();
  });

  it('validates password mismatch on submit', async () => {
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText('currentPasswordLabel'), {
      target: { value: 'OldPass123' },
    });
    fireEvent.change(screen.getByLabelText('newPasswordLabel'), {
      target: { value: 'NewPass123' },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: 'Different123' },
    });

    fireEvent.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('errors.passwordMismatch')).toBeInTheDocument();
    });
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('validates that new password differs from current (client-side)', async () => {
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText('currentPasswordLabel'), {
      target: { value: 'SamePass123' },
    });
    fireEvent.change(screen.getByLabelText('newPasswordLabel'), {
      target: { value: 'SamePass123' },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: 'SamePass123' },
    });

    fireEvent.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('errors.sameAsCurrent')).toBeInTheDocument();
    });
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('validates new password minimum length', async () => {
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText('currentPasswordLabel'), {
      target: { value: 'OldPass123' },
    });
    fireEvent.change(screen.getByLabelText('newPasswordLabel'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: 'short' },
    });

    fireEvent.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('errors.newTooShort')).toBeInTheDocument();
    });
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('submits with valid data and shows success toast, clears form', async () => {
    mockChangePassword.mockResolvedValueOnce(undefined);
    render(<ChangePasswordForm />);

    const current = screen.getByLabelText('currentPasswordLabel') as HTMLInputElement;
    const newInput = screen.getByLabelText('newPasswordLabel') as HTMLInputElement;
    const confirm = screen.getByLabelText('confirmPasswordLabel') as HTMLInputElement;

    fireEvent.change(current, { target: { value: 'OldPass123' } });
    fireEvent.change(newInput, { target: { value: 'NewSecurePass456' } });
    fireEvent.change(confirm, { target: { value: 'NewSecurePass456' } });

    fireEvent.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith('OldPass123', 'NewSecurePass456');
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'successMessage');
    });
    expect(current.value).toBe('');
    expect(newInput.value).toBe('');
    expect(confirm.value).toBe('');
  });

  it('displays localized error for INVALID_CURRENT_PASSWORD errorCode', async () => {
    const err = Object.assign(new Error('Current password is incorrect'), {
      errorCode: 'AUTH_INVALID_CURRENT_PASSWORD',
    });
    mockChangePassword.mockRejectedValueOnce(err);
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText('currentPasswordLabel'), {
      target: { value: 'WrongPass1' },
    });
    fireEvent.change(screen.getByLabelText('newPasswordLabel'), {
      target: { value: 'NewSecurePass456' },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: 'NewSecurePass456' },
    });

    fireEvent.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('errors.invalidCurrent')).toBeInTheDocument();
    });
  });

  it('displays localized error for PASSWORD_NOT_SET errorCode', async () => {
    const err = Object.assign(new Error('No password is set'), {
      errorCode: 'AUTH_PASSWORD_NOT_SET',
    });
    mockChangePassword.mockRejectedValueOnce(err);
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText('currentPasswordLabel'), {
      target: { value: 'AnyPass123' },
    });
    fireEvent.change(screen.getByLabelText('newPasswordLabel'), {
      target: { value: 'NewSecurePass456' },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: 'NewSecurePass456' },
    });

    fireEvent.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('errors.passwordNotSet')).toBeInTheDocument();
    });
  });

  it('displays generic error for unknown errors', async () => {
    mockChangePassword.mockRejectedValueOnce(new Error('Network error'));
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText('currentPasswordLabel'), {
      target: { value: 'OldPass123' },
    });
    fireEvent.change(screen.getByLabelText('newPasswordLabel'), {
      target: { value: 'NewSecurePass456' },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: 'NewSecurePass456' },
    });

    fireEvent.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('errors.generic')).toBeInTheDocument();
    });
  });
});
