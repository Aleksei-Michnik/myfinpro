import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteAccountDialog } from './DeleteAccountDialog';

const mockDeleteAccount = vi.fn();

let mockAuthState: {
  user: {
    id: string;
    email: string;
    name: string;
    defaultCurrency: string;
    locale: string;
    emailVerified: boolean;
    deletedAt: string | null;
    scheduledDeletionAt: string | null;
  } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  login: ReturnType<typeof vi.fn>;
  loginWithToken: ReturnType<typeof vi.fn>;
  loginWithTelegram: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  getAccessToken: () => string | null;
  resendVerificationEmail: ReturnType<typeof vi.fn>;
  refreshUser: ReturnType<typeof vi.fn>;
  deleteAccount: ReturnType<typeof vi.fn>;
  cancelDeletion: ReturnType<typeof vi.fn>;
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockAuthState,
}));

describe('DeleteAccountDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      user: {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        defaultCurrency: 'USD',
        locale: 'en',
        emailVerified: true,
        deletedAt: null,
        scheduledDeletionAt: null,
      },
      isAuthenticated: true,
      isLoading: false,
      accessToken: 'mock-token',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      loginWithTelegram: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      getAccessToken: () => 'mock-token',
      resendVerificationEmail: vi.fn(),
      refreshUser: vi.fn(),
      deleteAccount: mockDeleteAccount,
      cancelDeletion: vi.fn(),
    };
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<DeleteAccountDialog isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when isOpen is true', () => {
    render(<DeleteAccountDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('delete-account-dialog')).toBeInTheDocument();
    expect(screen.getByText('deleteAccount')).toBeInTheDocument();
    expect(screen.getByTestId('delete-warning')).toBeInTheDocument();
  });

  it('has delete button disabled when email does not match', () => {
    render(<DeleteAccountDialog isOpen={true} onClose={vi.fn()} />);
    const deleteBtn = screen.getByTestId('confirm-delete-btn');
    expect(deleteBtn).toBeDisabled();
  });

  it('enables delete button when email matches', () => {
    render(<DeleteAccountDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    const deleteBtn = screen.getByTestId('confirm-delete-btn');
    expect(deleteBtn).not.toBeDisabled();
  });

  it('calls deleteAccount on submit with matching email', async () => {
    mockDeleteAccount.mockResolvedValueOnce(undefined);
    render(<DeleteAccountDialog isOpen={true} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    fireEvent.click(screen.getByTestId('confirm-delete-btn'));

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledWith('test@example.com');
    });
  });

  it('shows error when deleteAccount fails', async () => {
    mockDeleteAccount.mockRejectedValueOnce(new Error('Email mismatch'));
    render(<DeleteAccountDialog isOpen={true} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    fireEvent.click(screen.getByTestId('confirm-delete-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-error')).toHaveTextContent('Email mismatch');
    });
  });

  it('shows loading state during API call', async () => {
    let resolveDelete: () => void;
    mockDeleteAccount.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    render(<DeleteAccountDialog isOpen={true} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    fireEvent.click(screen.getByTestId('confirm-delete-btn'));

    expect(screen.getByTestId('confirm-delete-btn')).toHaveTextContent('...');
    expect(screen.getByTestId('confirm-delete-btn')).toBeDisabled();

    resolveDelete!();

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalled();
    });
  });

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<DeleteAccountDialog isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('cancel-delete-btn'));

    expect(onClose).toHaveBeenCalled();
  });

  it('does not submit when email does not match', () => {
    render(<DeleteAccountDialog isOpen={true} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'wrong@example.com' } });

    const deleteBtn = screen.getByTestId('confirm-delete-btn');
    expect(deleteBtn).toBeDisabled();
  });
});
