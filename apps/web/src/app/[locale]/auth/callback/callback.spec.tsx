import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OAuthCallbackPage from './page';

const mockLoginWithToken = vi.fn();
const mockPush = vi.fn();
const mockAddToast = vi.fn();
let mockSearchParams = new URLSearchParams();

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

// Mock @/i18n/navigation
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// Mock auth context
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    loginWithToken: mockLoginWithToken,
    user: null,
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getAccessToken: () => null,
  }),
}));

// Mock Toast
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('OAuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('renders loading spinner with sign-in message', () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockLoginWithToken.mockReturnValue(new Promise(() => {})); // never resolves

    render(<OAuthCallbackPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('googleSignInProgress')).toBeInTheDocument();
  });

  it('calls loginWithToken with token from URL params', async () => {
    mockSearchParams = new URLSearchParams('token=test-oauth-token');
    mockLoginWithToken.mockResolvedValueOnce(undefined);

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockLoginWithToken).toHaveBeenCalledWith('test-oauth-token');
    });
  });

  it('redirects to dashboard and shows success toast on successful login', async () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockLoginWithToken.mockResolvedValueOnce(undefined);

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });

    expect(mockAddToast).toHaveBeenCalledWith('success', 'oauthSuccess');
  });

  it('redirects to login and shows error toast when token is missing', async () => {
    mockSearchParams = new URLSearchParams(); // no token

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login');
    });

    expect(mockAddToast).toHaveBeenCalledWith('error', 'oauthError');
    expect(mockLoginWithToken).not.toHaveBeenCalled();
  });

  it('redirects to login and shows error toast when loginWithToken fails', async () => {
    mockSearchParams = new URLSearchParams('token=invalid-token');
    mockLoginWithToken.mockRejectedValueOnce(new Error('Invalid token'));

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login');
    });

    expect(mockAddToast).toHaveBeenCalledWith('error', 'oauthError');
  });

  it('handles network error during loginWithToken', async () => {
    mockSearchParams = new URLSearchParams('token=valid-token');
    mockLoginWithToken.mockRejectedValueOnce(new Error('Network error'));

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login');
    });

    expect(mockAddToast).toHaveBeenCalledWith('error', 'oauthError');
  });
});
