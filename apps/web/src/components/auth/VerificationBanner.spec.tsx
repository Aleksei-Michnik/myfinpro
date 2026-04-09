import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationBanner } from './VerificationBanner';

const mockResendVerificationEmail = vi.fn();
const mockAddToast = vi.fn();

let mockAuthState: {
  user: {
    id: string;
    email: string;
    name: string;
    defaultCurrency: string;
    locale: string;
    emailVerified: boolean;
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
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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

describe('VerificationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      user: {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        defaultCurrency: 'USD',
        locale: 'en',
        emailVerified: false,
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
      resendVerificationEmail: mockResendVerificationEmail,
      refreshUser: vi.fn(),
    };
  });

  it('renders nothing when user is null (unauthenticated)', () => {
    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    const { container } = render(<VerificationBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when user.emailVerified is true', () => {
    mockAuthState.user!.emailVerified = true;
    const { container } = render(<VerificationBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders banner when user.emailVerified is false', () => {
    render(<VerificationBanner />);
    expect(screen.getByTestId('verification-banner')).toBeInTheDocument();
    expect(screen.getByText('verifyEmailBanner', { exact: false })).toBeInTheDocument();
  });

  it('does not render for Telegram users (email contains @telegram.user)', () => {
    mockAuthState.user!.email = 'telegram_123456@telegram.user';
    const { container } = render(<VerificationBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('clicking resend calls resendVerificationEmail', async () => {
    mockResendVerificationEmail.mockResolvedValueOnce(undefined);
    render(<VerificationBanner />);

    fireEvent.click(screen.getByTestId('resend-verification-btn'));

    await waitFor(() => {
      expect(mockResendVerificationEmail).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'verifyEmailSent');
    });
  });

  it('shows loading state while resending', async () => {
    let resolveResend: () => void;
    mockResendVerificationEmail.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveResend = resolve;
      }),
    );

    render(<VerificationBanner />);

    fireEvent.click(screen.getByTestId('resend-verification-btn'));

    // Should show resending text
    expect(screen.getByTestId('resend-verification-btn')).toHaveTextContent(
      'resendingVerification',
    );
    expect(screen.getByTestId('resend-verification-btn')).toBeDisabled();

    // Resolve the promise
    resolveResend!();

    await waitFor(() => {
      expect(screen.getByTestId('resend-verification-btn')).toHaveTextContent('resendVerification');
    });
  });
});
