import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AccountSettingsPage from './page';

// Mock Intl.supportedValuesOf for test environment
const IntlAny = Intl as unknown as Record<string, unknown>;
if (typeof IntlAny.supportedValuesOf !== 'function') {
  IntlAny.supportedValuesOf = () => [
    'UTC',
    'America/New_York',
    'Europe/London',
    'Asia/Jerusalem',
    'Asia/Tokyo',
  ];
}

const mockPush = vi.fn();
const mockAddToast = vi.fn();
const mockUpdateProfile = vi.fn();

let mockAuthState: {
  user: {
    id: string;
    email: string;
    name: string;
    defaultCurrency: string;
    locale: string;
    timezone: string;
    emailVerified: boolean;
    hasPassword: boolean;
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
  updateProfile: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params) {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/settings/account',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('@/components/auth/ConnectedAccounts', () => ({
  ConnectedAccounts: () => <div data-testid="connected-accounts">Connected Accounts Mock</div>,
}));

vi.mock('@/components/auth/ChangePasswordForm', () => ({
  ChangePasswordForm: () => <div data-testid="change-password-form">Change Password Form Mock</div>,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateProfile.mockResolvedValue(undefined);
    mockAuthState = {
      user: {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        defaultCurrency: 'USD',
        locale: 'en',
        timezone: 'UTC',
        emailVerified: true,
        hasPassword: true,
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
      deleteAccount: vi.fn(),
      cancelDeletion: vi.fn(),
      updateProfile: mockUpdateProfile,
      changePassword: vi.fn(),
    };
  });

  it('renders page with title', () => {
    render(<AccountSettingsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('title');
  });

  it('displays user information', () => {
    render(<AccountSettingsPage />);
    expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
    expect(screen.getByTestId('user-name')).toHaveTextContent('Test User');
    expect(screen.getByTestId('user-provider')).toHaveTextContent('Email');
  });

  it('displays Telegram as provider for telegram users', () => {
    mockAuthState.user!.email = 'tg_123@telegram.user';
    render(<AccountSettingsPage />);
    expect(screen.getByTestId('user-provider')).toHaveTextContent('Telegram');
  });

  it('shows delete account button when no scheduled deletion', () => {
    render(<AccountSettingsPage />);
    expect(screen.getByTestId('open-delete-dialog-btn')).toBeInTheDocument();
  });

  it('opens delete dialog when delete button is clicked', () => {
    render(<AccountSettingsPage />);
    fireEvent.click(screen.getByTestId('open-delete-dialog-btn'));
    expect(screen.getByTestId('delete-account-dialog')).toBeInTheDocument();
  });

  it('shows deletion banner instead of delete button when deletion is scheduled', () => {
    mockAuthState.user!.scheduledDeletionAt = '2026-05-07T00:00:00.000Z';
    render(<AccountSettingsPage />);
    expect(screen.getByTestId('deletion-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('open-delete-dialog-btn')).not.toBeInTheDocument();
  });

  it('does not redirect when user is authenticated', () => {
    render(<AccountSettingsPage />);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('renders connected accounts section', () => {
    render(<AccountSettingsPage />);
    expect(screen.getByTestId('connected-accounts-section')).toBeInTheDocument();
    expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
  });

  it('renders preferences section with language, currency and timezone dropdowns', () => {
    render(<AccountSettingsPage />);
    expect(screen.getByTestId('preferences-section')).toBeInTheDocument();
    expect(screen.getByTestId('language-select')).toBeInTheDocument();
    expect(screen.getByTestId('currency-select')).toBeInTheDocument();
    expect(screen.getByTestId('timezone-select')).toBeInTheDocument();
    expect(screen.getByTestId('save-preferences-btn')).toBeInTheDocument();
  });

  it('pre-populates dropdowns with current user values', () => {
    render(<AccountSettingsPage />);
    expect(screen.getByTestId('language-select')).toHaveValue('en');
    expect(screen.getByTestId('currency-select')).toHaveValue('USD');
    expect(screen.getByTestId('timezone-select')).toHaveValue('UTC');
  });

  it('save button calls updateProfile', async () => {
    render(<AccountSettingsPage />);
    fireEvent.click(screen.getByTestId('save-preferences-btn'));
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        locale: 'en',
        defaultCurrency: 'USD',
        timezone: 'UTC',
      });
    });
  });

  it('shows success toast on save', async () => {
    render(<AccountSettingsPage />);
    fireEvent.click(screen.getByTestId('save-preferences-btn'));
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'preferencesSaved');
    });
  });

  it('shows error toast on save failure', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error('Failed'));
    render(<AccountSettingsPage />);
    fireEvent.click(screen.getByTestId('save-preferences-btn'));
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'preferencesError');
    });
  });

  describe('Password section', () => {
    it('renders password section with change form for users with password', () => {
      render(<AccountSettingsPage />);
      expect(screen.getByTestId('password-section')).toBeInTheDocument();
      expect(screen.getByTestId('change-password-form')).toBeInTheDocument();
      expect(screen.queryByTestId('password-oauth-only-notice')).not.toBeInTheDocument();
    });

    it('renders OAuth-only notice for users without password', () => {
      mockAuthState.user!.hasPassword = false;
      render(<AccountSettingsPage />);
      expect(screen.getByTestId('password-section')).toBeInTheDocument();
      expect(screen.getByTestId('password-oauth-only-notice')).toBeInTheDocument();
      expect(screen.queryByTestId('change-password-form')).not.toBeInTheDocument();
    });

    it('OAuth-only notice includes link to forgot-password', () => {
      mockAuthState.user!.hasPassword = false;
      render(<AccountSettingsPage />);
      const link = screen.getByRole('link', { name: /resetPasswordLink/ });
      expect(link).toHaveAttribute('href', '/auth/forgot-password');
    });
  });
});
