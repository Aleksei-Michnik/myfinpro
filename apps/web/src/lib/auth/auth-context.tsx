'use client';

// Phase 6 · Iteration 6.18.1.4-hotfix — proactive token refresh.
//
// Three things happen here that did not before:
//
//   1. A 12-minute `setInterval` (TOKEN_REFRESH_INTERVAL_MS) calls
//      `POST /auth/refresh` while authenticated, rotating the access
//      token *before* the 15-minute JWT TTL expires. This eliminates
//      the 401 storm that used to follow the in-memory token going
//      stale.
//
//   2. The `api-client` interceptor is wired to this provider via
//      `configureApiAuth`. Any 401 from a regular request triggers a
//      single shared refresh; on success the new access token is
//      written back here and the original request is retried
//      transparently.
//
//   3. A `BroadcastChannel('auth')` listener picks up token refreshes
//      from other tabs of the same browser, so concurrent tabs share
//      one fresh token instead of each issuing their own refresh.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { User, LoginData, RegisterData, AuthResponse } from './types';
import type { TelegramLoginResult } from '@/components/auth/TelegramLoginButton';
import {
  AUTH_BROADCAST_CHANNEL,
  TOKEN_REFRESHED_MESSAGE,
  configureApiAuth,
  type AuthBroadcastMessage,
} from '@/lib/api-client';

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginData) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  loginWithTelegram: (data: TelegramLoginResult) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | null;
  resendVerificationEmail: () => Promise<void>;
  refreshUser: () => Promise<void>;
  deleteAccount: (email: string) => Promise<void>;
  cancelDeletion: () => Promise<void>;
  updateProfile: (data: {
    defaultCurrency?: string;
    timezone?: string;
    locale?: string;
  }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

interface ApiErrorPayload {
  message?: string;
  errorCode?: string;
}

class ApiError extends Error {
  errorCode?: string;
  constructor(message: string, errorCode?: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

/**
 * Refresh the access token at 80 % of the 15-minute JWT TTL. Slightly
 * before expiry leaves head-room for clock skew and slow networks
 * without making the rotation noticeable to the user.
 */
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 1000;

const syncLocaleCookie = (locale: string) => {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true); // true initially for silent refresh

  // Mirror token in a ref so the api-client adapter always reads the
  // latest value without re-configuring on every render.
  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current = accessToken;

  const isAuthenticated = !!user && !!accessToken;

  const clearAuthState = useCallback(() => {
    setUser(null);
    setAccessToken(null);
  }, []);

  // Wire (and tear down) the api-client adapter. The api-client uses
  // these callbacks to attach the Bearer header, persist refreshed
  // tokens, and trigger logout when the server-side refresh fails.
  useEffect(() => {
    configureApiAuth({
      getAccessToken: () => accessTokenRef.current,
      setAccessToken: (token) => setAccessToken(token),
      onAuthFailed: () => {
        // Token rotation failed — the server-side session is gone.
        // Drop the in-memory token; downstream effects (UI redirect)
        // are owned by the consuming pages.
        clearAuthState();
      },
    });
    return () => configureApiAuth(null);
  }, [clearAuthState]);

  // Silent refresh on mount + proactive refresh interval while
  // authenticated.
  useEffect(() => {
    let cancelled = false;
    const silentRefresh = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (cancelled) return;
        if (res.ok) {
          const data: AuthResponse = await res.json();
          setUser(data.user);
          setAccessToken(data.accessToken);
          if (data.user.locale) {
            syncLocaleCookie(data.user.locale);
          }
        }
      } catch {
        // Silent fail — user is not logged in
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    silentRefresh();
    return () => {
      cancelled = true;
    };
  }, []);

  // Proactive refresh interval — runs only while authenticated. Calls
  // /auth/refresh directly to avoid bouncing through the api-client
  // 401 retry path (which is reactive, not proactive).
  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!active) return;
        if (res.ok) {
          const data = (await res.json()) as AuthResponse;
          setUser(data.user);
          setAccessToken(data.accessToken);
        } else {
          // Refresh-token cookie expired or revoked — drop session.
          clearAuthState();
        }
      } catch {
        // Network failure — keep current token, the interval will
        // retry on the next tick. A real expiry will be caught by the
        // 401 interceptor as the safety net.
      }
    };

    const interval = window.setInterval(tick, TOKEN_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isAuthenticated, clearAuthState]);

  // Cross-tab sync: adopt access tokens refreshed in any other tab.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    const onMessage = (ev: MessageEvent<AuthBroadcastMessage>) => {
      if (ev.data?.type === TOKEN_REFRESHED_MESSAGE && ev.data.accessToken) {
        setAccessToken(ev.data.accessToken);
      }
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, []);

  const login = useCallback(async (data: LoginData) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 429) {
      throw new Error('Too many attempts. Please try again later.');
    }
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Login failed' }));
      throw new Error((error as { message?: string }).message || 'Login failed');
    }
    const result: AuthResponse = await res.json();
    setUser(result.user);
    setAccessToken(result.accessToken);
    if (result.user.locale) {
      syncLocaleCookie(result.user.locale);
    }
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 429) {
      throw new Error('Too many attempts. Please try again later.');
    }
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Registration failed' }));
      throw new Error((error as { message?: string }).message || 'Registration failed');
    }
    const result: AuthResponse = await res.json();
    setUser(result.user);
    setAccessToken(result.accessToken);
    if (result.user.locale) {
      syncLocaleCookie(result.user.locale);
    }
  }, []);

  const loginWithTelegram = useCallback(async (data: TelegramLoginResult) => {
    const res = await fetch(`${API_BASE}/auth/telegram/callback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Telegram authentication failed' }));
      throw new Error((error as { message?: string }).message || 'Telegram authentication failed');
    }
    const result: AuthResponse = await res.json();
    setUser(result.user);
    setAccessToken(result.accessToken);
    if (result.user.locale) {
      syncLocaleCookie(result.user.locale);
    }
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setAccessToken(token);
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        setAccessToken(null);
        throw new Error('Failed to authenticate with token');
      }
      const userData: User = await res.json();
      setUser(userData);
      if (userData.locale) {
        syncLocaleCookie(userData.locale);
      }
    } catch (error) {
      setAccessToken(null);
      setUser(null);
      throw error;
    }
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    const token = accessToken;
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API_BASE}/auth/send-verification-email`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const error = await res
        .json()
        .catch(() => ({ message: 'Failed to send verification email' }));
      throw new Error(
        (error as { message?: string }).message || 'Failed to send verification email',
      );
    }
  }, [accessToken]);

  const refreshUser = useCallback(async () => {
    const token = accessToken;
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const userData: User = await res.json();
        setUser(userData);
        if (userData.locale) {
          syncLocaleCookie(userData.locale);
        }
      }
    } catch {
      // Silent fail
    }
  }, [accessToken]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Logout even if API call fails
    }
    clearAuthState();
  }, [clearAuthState]);

  const getAccessToken = useCallback(() => accessToken, [accessToken]);

  const deleteAccount = useCallback(
    async (email: string) => {
      const token = accessToken;
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/auth/delete-account`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to delete account' }));
        throw new Error((error as { message?: string }).message || 'Failed to delete account');
      }
      await logout();
    },
    [accessToken, logout],
  );

  const cancelDeletion = useCallback(async () => {
    const token = accessToken;
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API_BASE}/auth/cancel-deletion`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Failed to cancel deletion' }));
      throw new Error((error as { message?: string }).message || 'Failed to cancel deletion');
    }
    await refreshUser();
  }, [accessToken, refreshUser]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const token = accessToken;
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const error = (await res.json().catch(() => ({
          message: 'Failed to change password',
        }))) as ApiErrorPayload;
        throw new ApiError(error.message || 'Failed to change password', error.errorCode);
      }
    },
    [accessToken],
  );

  const updateProfile = useCallback(
    async (data: { defaultCurrency?: string; timezone?: string; locale?: string }) => {
      const token = accessToken;
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/auth/profile`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to update preferences' }));
        throw new Error((error as { message?: string }).message || 'Failed to update preferences');
      }
      const updatedUser: User = await res.json();
      setUser(updatedUser);
      if (data.locale && updatedUser.locale) {
        syncLocaleCookie(updatedUser.locale);
        window.location.reload();
      }
    },
    [accessToken],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated,
        isLoading,
        login,
        loginWithToken,
        loginWithTelegram,
        register,
        logout,
        getAccessToken,
        resendVerificationEmail,
        refreshUser,
        deleteAccount,
        cancelDeletion,
        updateProfile,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/** Exported for tests — mirrors the in-module constant. */
export const TOKEN_REFRESH_INTERVAL_MS_FOR_TESTS = TOKEN_REFRESH_INTERVAL_MS;
