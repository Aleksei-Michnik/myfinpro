import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AccountSettingsPage from './page';

const mockPush = vi.fn();

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

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: vi.fn(),
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('AccountSettingsPage', () => {
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
      deleteAccount: vi.fn(),
      cancelDeletion: vi.fn(),
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
});
