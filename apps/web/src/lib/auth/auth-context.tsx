'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User, LoginData, RegisterData, AuthResponse } from './types';
import type { TelegramLoginResult } from '@/components/auth/TelegramLoginButton';

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true); // true initially for silent refresh

  const isAuthenticated = !!user && !!accessToken;

  // Silent refresh on mount
  useEffect(() => {
    const silentRefresh = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data: AuthResponse = await res.json();
          setUser(data.user);
          setAccessToken(data.accessToken);
        }
      } catch {
        // Silent fail — user is not logged in
      } finally {
        setIsLoading(false);
      }
    };
    silentRefresh();
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
    setUser(null);
    setAccessToken(null);
  }, []);

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
