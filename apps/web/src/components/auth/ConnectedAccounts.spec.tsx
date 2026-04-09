import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectedAccounts } from './ConnectedAccounts';

// ── Mock state ────────────────────────────────────────────────────────────────
let mockAccessToken: string | null = 'mock-token';

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    accessToken: mockAccessToken,
    user: { name: 'Test User', emailVerified: true },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    loginWithToken: vi.fn(),
    loginWithTelegram: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getAccessToken: () => mockAccessToken,
    resendVerificationEmail: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const translations: Record<string, Record<string, string>> = {
      settings: {
        emailPassword: 'Email & Password',
        connected: 'Connected',
        notConnected: 'Not connected',
        connectGoogle: 'Connect Google',
        connectTelegram: 'Connect Telegram',
        disconnect: 'Disconnect',
        disconnectConfirm: 'Are you sure you want to disconnect {provider}?',
        disconnectSuccess: '{provider} disconnected successfully',
        disconnectError: 'Failed to disconnect {provider}',
        cannotDisconnectLast: 'Cannot disconnect your last sign-in method',
        linkSuccess: '{provider} connected successfully',
        linkError: 'Failed to connect {provider}',
        alreadyLinked: 'This {provider} account is already linked to another user',
      },
      common: {
        cancel: 'Cancel',
      },
    };
    return (key: string, params?: Record<string, string>) => {
      const nsTranslations = translations[ns] || {};
      let value = nsTranslations[key] || key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          value = value.replace(`{${k}}`, v);
        });
      }
      return value;
    };
  },
}));

const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast, toasts: [], removeToast: vi.fn() }),
}));

// Mock the TelegramLoginButton hook
const mockTriggerLogin = vi.fn();
vi.mock('@/components/auth/TelegramLoginButton', () => ({
  useTelegramLogin: ({ onAuth }: { onAuth: (data: unknown) => void }) => {
    // Store onAuth for tests to invoke
    (globalThis as Record<string, unknown>).__telegramOnAuth = onAuth;
    return {
      triggerLogin: mockTriggerLogin,
      isReady: true,
      isLoading: false,
    };
  },
}));

// ── Helper ────────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

function renderComponent() {
  return render(<ConnectedAccounts />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ConnectedAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessToken = 'mock-token';
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const connectedAccountsResponse = {
    hasPassword: true,
    providers: [
      {
        provider: 'google',
        name: 'Google User',
        email: 'google@example.com',
        avatarUrl: null,
        connectedAt: '2026-01-01T00:00:00Z',
      },
      {
        provider: 'telegram',
        name: 'Telegram User',
        email: null,
        avatarUrl: null,
        connectedAt: '2026-02-01T00:00:00Z',
      },
    ],
  };

  it('shows loading spinner while fetching', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    renderComponent();
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error message when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('renders provider list with all providers connected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(connectedAccountsResponse),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // All three sections visible
    expect(screen.getByText('Email & Password')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Telegram')).toBeInTheDocument();
  });

  it('shows "Connected" for linked providers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(connectedAccountsResponse),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // hasPassword=true, both providers connected → 3 "Connected" badges
    const connectedBadges = screen.getAllByText('Connected');
    expect(connectedBadges.length).toBe(3);
  });

  it('shows "Not connected" for unlinked providers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          hasPassword: false,
          providers: [],
        }),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    const notConnected = screen.getAllByText('Not connected');
    expect(notConnected.length).toBe(3); // email, google, telegram
  });

  it('shows Disconnect button for connected Google', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(connectedAccountsResponse),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // Two disconnect buttons: one for Google, one for Telegram
    const disconnectButtons = screen.getAllByText('Disconnect');
    expect(disconnectButtons.length).toBe(2);
  });

  it('shows confirmation dialog before disconnect', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(connectedAccountsResponse),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // Click first disconnect button (Google)
    const disconnectButtons = screen.getAllByText('Disconnect');
    fireEvent.click(disconnectButtons[0]);

    // Should show confirmation
    expect(screen.getByText('Are you sure you want to disconnect google?')).toBeInTheDocument();
  });

  it('calls DELETE API when disconnect is confirmed', async () => {
    const updatedResponse = {
      hasPassword: true,
      providers: [
        {
          provider: 'telegram',
          name: 'Telegram User',
          email: null,
          avatarUrl: null,
          connectedAt: '2026-02-01T00:00:00Z',
        },
      ],
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(connectedAccountsResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedResponse),
      });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // Click first disconnect (Google)
    const disconnectButtons = screen.getAllByText('Disconnect');
    fireEvent.click(disconnectButtons[0]);

    // Now confirm — click the confirm Disconnect button that appears
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to disconnect google?')).toBeInTheDocument();
    });

    // Find the disconnect button in the confirmation row (not the one for telegram)
    const allDisconnect = screen.getAllByText('Disconnect');
    // The confirmation "Disconnect" button is within the google card
    await act(async () => {
      fireEvent.click(allDisconnect[0]);
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/connected-accounts/google'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('shows "Cannot disconnect last auth method" error', async () => {
    const singleProviderResponse = {
      hasPassword: false,
      providers: [
        {
          provider: 'telegram',
          name: 'Telegram User',
          email: null,
          avatarUrl: null,
          connectedAt: '2026-02-01T00:00:00Z',
        },
      ],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(singleProviderResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            message: 'Cannot unlink the last authentication method',
            errorCode: 'CANNOT_UNLINK_LAST_AUTH',
          }),
      });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // Click disconnect for Telegram
    const disconnectBtn = screen.getByText('Disconnect');
    fireEvent.click(disconnectBtn);

    // Click confirm
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to disconnect telegram?')).toBeInTheDocument();
    });
    const confirmDisconnect = screen.getAllByText('Disconnect');
    await act(async () => {
      fireEvent.click(confirmDisconnect[0]);
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'error',
        'Cannot disconnect your last sign-in method',
      );
    });
  });

  it('shows error toast on failed disconnect', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(connectedAccountsResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Server error' }),
      });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // Click disconnect for Google
    fireEvent.click(screen.getAllByText('Disconnect')[0]);

    // Confirm
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to disconnect google?')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getAllByText('Disconnect')[0]);
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to disconnect google');
    });
  });

  it('shows Connect Google button when Google is not connected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          hasPassword: true,
          providers: [],
        }),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    expect(screen.getByText('Connect Google')).toBeInTheDocument();
  });

  it('shows Connect Telegram button when Telegram is not connected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          hasPassword: true,
          providers: [],
        }),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    expect(screen.getByText('Connect Telegram')).toBeInTheDocument();
  });

  it('shows provider name for connected providers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(connectedAccountsResponse),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    expect(screen.getByText('Google User')).toBeInTheDocument();
    expect(screen.getByText('Telegram User')).toBeInTheDocument();
  });

  it('cancel button in confirmation dismisses it', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(connectedAccountsResponse),
    });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('connected-accounts')).toBeInTheDocument();
    });

    // Click disconnect for Google
    fireEvent.click(screen.getAllByText('Disconnect')[0]);

    // Confirm dialog visible
    expect(screen.getByText('Are you sure you want to disconnect google?')).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(screen.getByText('Cancel'));

    // Confirmation should be gone
    expect(
      screen.queryByText('Are you sure you want to disconnect google?'),
    ).not.toBeInTheDocument();
  });
});
