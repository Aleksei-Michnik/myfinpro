import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeletionBanner } from './DeletionBanner';

const mockCancelDeletion = vi.fn();
const mockAddToast = vi.fn();

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
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params) {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('DeletionBanner', () => {
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
        scheduledDeletionAt: '2026-05-07T00:00:00.000Z',
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
      deleteAccount: vi.fn(),
      cancelDeletion: mockCancelDeletion,
    };
  });

  it('renders nothing when user is null', () => {
    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    const { container } = render(<DeletionBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when scheduledDeletionAt is null', () => {
    mockAuthState.user!.scheduledDeletionAt = null;
    const { container } = render(<DeletionBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders banner when scheduledDeletionAt is set', () => {
    render(<DeletionBanner />);
    expect(screen.getByTestId('deletion-banner')).toBeInTheDocument();
    expect(screen.getByTestId('deletion-message')).toBeInTheDocument();
  });

  it('shows formatted deletion date', () => {
    render(<DeletionBanner />);
    const message = screen.getByTestId('deletion-message');
    // The mock translation returns key:params format
    expect(message.textContent).toContain('deletionScheduled');
  });

  it('calls cancelDeletion when cancel button is clicked', async () => {
    mockCancelDeletion.mockResolvedValueOnce(undefined);
    render(<DeletionBanner />);

    fireEvent.click(screen.getByTestId('cancel-deletion-btn'));

    await waitFor(() => {
      expect(mockCancelDeletion).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'cancelDeletionSuccess');
    });
  });

  it('shows loading state during cancel', async () => {
    let resolveCancel: () => void;
    mockCancelDeletion.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCancel = resolve;
      }),
    );

    render(<DeletionBanner />);

    fireEvent.click(screen.getByTestId('cancel-deletion-btn'));

    expect(screen.getByTestId('cancel-deletion-btn')).toHaveTextContent('...');
    expect(screen.getByTestId('cancel-deletion-btn')).toBeDisabled();

    resolveCancel!();

    await waitFor(() => {
      expect(screen.getByTestId('cancel-deletion-btn')).toHaveTextContent('cancelDeletion');
    });
  });

  it('shows error toast when cancelDeletion fails', async () => {
    mockCancelDeletion.mockRejectedValueOnce(new Error('Network error'));
    render(<DeletionBanner />);

    fireEvent.click(screen.getByTestId('cancel-deletion-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to cancel deletion');
    });
  });
});
