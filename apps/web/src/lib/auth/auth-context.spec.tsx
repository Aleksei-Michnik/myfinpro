import { render, screen, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AUTH_BROADCAST_CHANNEL,
  TOKEN_REFRESHED_MESSAGE,
  type AuthBroadcastMessage,
} from '../api-client';
import { AuthProvider, TOKEN_REFRESH_INTERVAL_MS_FOR_TESTS, useAuth } from './auth-context';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockUser = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  defaultCurrency: 'USD',
  locale: 'en',
  timezone: 'UTC',
  emailVerified: true,
};

const mockAuthResponse = {
  user: mockUser,
  accessToken: 'mock-access-token',
};

function TestConsumer() {
  const {
    user,
    isAuthenticated,
    isLoading,
    login,
    loginWithToken,
    register,
    logout,
    getAccessToken,
    deleteAccount,
    cancelDeletion,
    updateProfile,
    changePassword,
  } = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="user">{user ? user.name : 'null'}</span>
      <span data-testid="token">{getAccessToken() ?? 'null'}</span>
      {error && <span data-testid="error-message">{error}</span>}
      <button
        onClick={() =>
          login({ email: 'test@example.com', password: 'password' }).catch((err: Error) =>
            setError(err.message),
          )
        }
      >
        Login
      </button>
      <button
        onClick={() =>
          loginWithToken('oauth-test-token').catch((err: Error) => setError(err.message))
        }
      >
        LoginWithToken
      </button>
      <button
        onClick={() =>
          register({ email: 'test@example.com', password: 'password', name: 'Test' }).catch(
            (err: Error) => setError(err.message),
          )
        }
      >
        Register
      </button>
      <button onClick={() => logout()}>Logout</button>
      <button
        onClick={() =>
          deleteAccount('test@example.com').catch((err: Error) => setError(err.message))
        }
      >
        DeleteAccount
      </button>
      <button onClick={() => cancelDeletion().catch((err: Error) => setError(err.message))}>
        CancelDeletion
      </button>
      <button
        onClick={() =>
          updateProfile({ defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }).catch(
            (err: Error) => setError(err.message),
          )
        }
      >
        UpdateProfile
      </button>
      <button
        onClick={() =>
          changePassword('OldPass123', 'NewPass456').catch((err: Error & { errorCode?: string }) =>
            setError(err.errorCode || err.message),
          )
        }
      >
        ChangePassword
      </button>
    </div>
  );
}

function ThrowingConsumer() {
  try {
    useAuth();
    return <div>no error</div>;
  } catch (err) {
    return <div data-testid="error">{(err as Error).message}</div>;
  }
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: silent refresh fails (not logged in)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });
  });

  it('renders children', async () => {
    render(
      <AuthProvider>
        <div data-testid="child">Hello</div>
      </AuthProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('throws error when useAuth is used outside AuthProvider', () => {
    render(<ThrowingConsumer />);
    expect(screen.getByTestId('error')).toHaveTextContent(
      'useAuth must be used within an AuthProvider',
    );
  });

  it('starts with isLoading=true', () => {
    // Use a fetch that never resolves
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('sets isLoading=false after mount when refresh fails', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('restores session on mount when refresh succeeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('Test User');
    expect(screen.getByTestId('token')).toHaveTextContent('mock-access-token');
  });

  it('login calls API and updates state', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // Now mock login response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    await act(async () => {
      screen.getByText('Login').click();
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('Test User');

    // Verify login fetch call (second fetch after refresh)
    const loginCall = mockFetch.mock.calls[1];
    expect(loginCall[0]).toContain('/auth/login');
    expect(loginCall[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
  });

  it('login throws on API error and error is captured', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid credentials' }),
    });

    await act(async () => {
      screen.getByText('Login').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Invalid credentials');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('register calls API and updates state', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    await act(async () => {
      screen.getByText('Register').click();
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('Test User');

    const registerCall = mockFetch.mock.calls[1];
    expect(registerCall[0]).toContain('/auth/register');
    expect(registerCall[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
  });

  it('logout clears state', async () => {
    // Start with successful refresh (authenticated)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    // Mock logout response
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await act(async () => {
      screen.getByText('Logout').click();
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('null');
    expect(screen.getByTestId('token')).toHaveTextContent('null');

    const logoutCall = mockFetch.mock.calls[1];
    expect(logoutCall[0]).toContain('/auth/logout');
    expect(logoutCall[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
  });

  it('logout clears state even if API call fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      screen.getByText('Logout').click();
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('silent refresh handles network error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  describe('loginWithToken', () => {
    it('sets token and fetches user profile via /auth/me', async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      // Mock the /auth/me response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUser),
      });

      await act(async () => {
        screen.getByText('LoginWithToken').click();
      });

      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      expect(screen.getByTestId('user')).toHaveTextContent('Test User');
      expect(screen.getByTestId('token')).toHaveTextContent('oauth-test-token');

      // Verify /auth/me was called with Bearer token
      const meCall = mockFetch.mock.calls[1];
      expect(meCall[0]).toContain('/auth/me');
      expect(meCall[1]).toMatchObject({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-test-token',
        }),
      });
    });

    it('clears token and throws on /auth/me failure', async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      // Mock /auth/me failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized' }),
      });

      await act(async () => {
        screen.getByText('LoginWithToken').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(
          'Failed to authenticate with token',
        );
      });
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('user')).toHaveTextContent('null');
      expect(screen.getByTestId('token')).toHaveTextContent('null');
    });

    it('clears token and throws on network error', async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await act(async () => {
        screen.getByText('LoginWithToken').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Network error');
      });
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('token')).toHaveTextContent('null');
    });
  });

  describe('deleteAccount', () => {
    it('calls delete-account API then logs out', async () => {
      // Start authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      // Mock delete-account success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'Account scheduled for deletion' }),
      });
      // Mock logout call
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await act(async () => {
        screen.getByText('DeleteAccount').click();
      });

      // Verify delete-account was called
      const deleteCall = mockFetch.mock.calls[1];
      expect(deleteCall[0]).toContain('/auth/delete-account');
      expect(deleteCall[1]).toMatchObject({
        method: 'POST',
        credentials: 'include',
      });

      // Should be logged out after deletion
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('user')).toHaveTextContent('null');
    });

    it('throws on API error', async () => {
      // Start authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      // Mock delete-account failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Email does not match' }),
      });

      await act(async () => {
        screen.getByText('DeleteAccount').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Email does not match');
      });
    });
  });

  describe('cancelDeletion', () => {
    it('calls cancel-deletion API then refreshes user', async () => {
      // Start authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      // Mock cancel-deletion success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'Account deletion cancelled' }),
      });
      // Mock refreshUser /auth/me call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUser),
      });

      await act(async () => {
        screen.getByText('CancelDeletion').click();
      });

      // Verify cancel-deletion was called
      const cancelCall = mockFetch.mock.calls[1];
      expect(cancelCall[0]).toContain('/auth/cancel-deletion');
      expect(cancelCall[1]).toMatchObject({
        method: 'POST',
        credentials: 'include',
      });

      // User should still be authenticated
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    it('throws on API error', async () => {
      // Start authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      // Mock cancel-deletion failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'No pending deletion' }),
      });

      await act(async () => {
        screen.getByText('CancelDeletion').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('No pending deletion');
      });
    });
  });

  describe('updateProfile', () => {
    it('calls PATCH /auth/profile and updates user state', async () => {
      // Start authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      const updatedUser = { ...mockUser, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' };

      // Mock PATCH /auth/profile success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedUser),
      });

      await act(async () => {
        screen.getByText('UpdateProfile').click();
      });

      // Verify PATCH was called
      const profileCall = mockFetch.mock.calls[1];
      expect(profileCall[0]).toContain('/auth/profile');
      expect(profileCall[1]).toMatchObject({
        method: 'PATCH',
        credentials: 'include',
      });

      // User should still be authenticated
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    it('throws on API error', async () => {
      // Start authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      // Mock update failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Invalid currency' }),
      });

      await act(async () => {
        screen.getByText('UpdateProfile').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Invalid currency');
      });
    });
  });

  describe('changePassword', () => {
    it('POSTs to /auth/change-password with bearer token and succeeds (204)', async () => {
      // Start authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      // Mock successful change-password (204 No Content)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
      });

      await act(async () => {
        screen.getByText('ChangePassword').click();
      });

      const call = mockFetch.mock.calls[1];
      expect(call[0]).toContain('/auth/change-password');
      expect(call[1]).toMatchObject({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-access-token',
        }),
      });
      expect(JSON.parse(call[1].body as string)).toEqual({
        currentPassword: 'OldPass123',
        newPassword: 'NewPass456',
      });
      // Should remain authenticated after successful change
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    it('throws an ApiError with errorCode on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAuthResponse),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            message: 'Current password is incorrect',
            errorCode: 'AUTH_INVALID_CURRENT_PASSWORD',
          }),
      });

      await act(async () => {
        screen.getByText('ChangePassword').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(
          'AUTH_INVALID_CURRENT_PASSWORD',
        );
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 6 · 6.18.1.4-hotfix — proactive refresh + cross-tab broadcast.
// ─────────────────────────────────────────────────────────────────────

describe('AuthContext — proactive refresh (Phase 6 · 6.18.1.4-hotfix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes a 12-minute refresh interval constant', () => {
    expect(TOKEN_REFRESH_INTERVAL_MS_FOR_TESTS).toBe(12 * 60 * 1000);
  });

  it('registers a setInterval at TOKEN_REFRESH_INTERVAL_MS once authenticated', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    const { unmount } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    // setInterval was called with the 12-minute period.
    const intervalCall = setIntervalSpy.mock.calls.find(
      (c) => c[1] === TOKEN_REFRESH_INTERVAL_MS_FOR_TESTS,
    );
    expect(intervalCall).toBeDefined();

    // Tearing down the provider clears the interval.
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('drops the session when the api-client onAuthFailed hook fires (refresh failed)', async () => {
    // Start authenticated.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    // Trigger the api-client's onAuthFailed by re-importing and using a
    // 401 → 401 (refresh-fails) sequence on apiFetch.
    const { apiFetch } = await import('../api-client');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    });

    await act(async () => {
      await apiFetch('/some-endpoint');
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });
  });

  it('adopts a token broadcast on BroadcastChannel("auth") from another tab', async () => {
    // Start authenticated so we have a baseline token to compare against.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthResponse),
    });

    const listeners = new Set<(ev: MessageEvent<AuthBroadcastMessage>) => void>();
    let observedName: string | null = null;
    class TestChannel {
      constructor(name: string) {
        observedName = name;
      }
      addEventListener(_t: string, fn: (ev: MessageEvent<AuthBroadcastMessage>) => void) {
        listeners.add(fn);
      }
      removeEventListener(_t: string, fn: (ev: MessageEvent<AuthBroadcastMessage>) => void) {
        listeners.delete(fn);
      }
      postMessage(_d: unknown) {}
      close() {}
    }
    const original = global.BroadcastChannel;
    global.BroadcastChannel = TestChannel as unknown as typeof BroadcastChannel;

    try {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId('token')).toHaveTextContent('mock-access-token');
      });

      expect(observedName).toBe(AUTH_BROADCAST_CHANNEL);

      // Simulate another tab broadcasting a refreshed token.
      await act(async () => {
        for (const fn of listeners) {
          fn({
            data: { type: TOKEN_REFRESHED_MESSAGE, accessToken: 'cross-tab' },
          } as MessageEvent<AuthBroadcastMessage>);
        }
      });

      expect(screen.getByTestId('token')).toHaveTextContent('cross-tab');
    } finally {
      global.BroadcastChannel = original;
    }
  });
});
