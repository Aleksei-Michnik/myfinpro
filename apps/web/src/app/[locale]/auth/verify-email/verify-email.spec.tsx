import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VerifyEmailPage from './page';

const mockResendVerificationEmail = vi.fn();
const mockRefreshUser = vi.fn();
const mockAddToast = vi.fn();
let mockSearchParams = new URLSearchParams();
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    login: vi.fn(),
    loginWithToken: vi.fn(),
    loginWithTelegram: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getAccessToken: () => null,
    resendVerificationEmail: mockResendVerificationEmail,
    refreshUser: mockRefreshUser,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows loading state initially', () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves

    render(<VerifyEmailPage />);

    expect(screen.getByTestId('verify-loading')).toBeInTheDocument();
  });

  it('shows success message on valid token', async () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockRefreshUser.mockResolvedValueOnce(undefined);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'Email verified' }),
    });

    render(<VerifyEmailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-success')).toBeInTheDocument();
    });

    expect(screen.getByText('verifyEmailSuccess')).toBeInTheDocument();
    expect(screen.getByText('goToDashboard')).toBeInTheDocument();
  });

  it('shows expired message and resend button on expired token', async () => {
    mockSearchParams = new URLSearchParams('token=expired-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          message: 'Token expired',
          errorCode: 'EMAIL_VERIFICATION_EXPIRED',
        }),
    });

    render(<VerifyEmailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-expired')).toBeInTheDocument();
    });

    expect(screen.getByText('verifyEmailExpired')).toBeInTheDocument();
    expect(screen.getByTestId('resend-btn')).toBeInTheDocument();
  });

  it('shows invalid message on unknown token', async () => {
    mockSearchParams = new URLSearchParams('token=bad-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          message: 'Invalid token',
          errorCode: 'UNKNOWN',
        }),
    });

    render(<VerifyEmailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-invalid')).toBeInTheDocument();
    });

    expect(screen.getByText('verifyEmailInvalid')).toBeInTheDocument();
  });

  it('shows no-token state when no token provided', async () => {
    mockSearchParams = new URLSearchParams(); // no token

    render(<VerifyEmailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-no-token')).toBeInTheDocument();
    });

    expect(screen.getByText('verifyEmailInvalid')).toBeInTheDocument();
    expect(screen.getByText('checkInbox')).toBeInTheDocument();
  });
});
