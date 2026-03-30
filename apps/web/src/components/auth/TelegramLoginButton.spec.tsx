import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTelegramLogin, type TelegramLoginResult } from './TelegramLoginButton';

describe('useTelegramLogin', () => {
  const mockOnAuth = vi.fn();
  const mockOnError = vi.fn();
  const botId = '123456789';

  // Track scripts added to document.head
  let appendedScripts: HTMLScriptElement[] = [];
  const originalContains = document.head.contains.bind(document.head);

  beforeEach(() => {
    vi.clearAllMocks();
    appendedScripts = [];

    // Mock document.head.appendChild to track script injection
    vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLScriptElement) {
        appendedScripts.push(node);
      }
      return node;
    });

    vi.spyOn(document.head, 'removeChild').mockImplementation((node: Node) => {
      appendedScripts = appendedScripts.filter((s) => s !== node);
      return node;
    });

    vi.spyOn(document.head, 'contains').mockImplementation((node: Node | null) => {
      if (node instanceof HTMLScriptElement) {
        return appendedScripts.includes(node);
      }
      return originalContains(node);
    });

    // Clean up any previous Telegram SDK mock
    delete (window as unknown as Record<string, unknown>).Telegram;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).Telegram;
  });

  it('injects the Telegram Login SDK script into document.head', () => {
    renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    expect(appendedScripts.length).toBe(1);
    expect(appendedScripts[0].src).toContain('oauth.telegram.org/js/telegram-login.js');
    expect(appendedScripts[0].async).toBe(true);
  });

  it('does not inject script when botId is empty', () => {
    renderHook(() => useTelegramLogin({ botId: '', onAuth: mockOnAuth }));

    expect(appendedScripts.length).toBe(0);
  });

  it('sets isReady=true when script loads', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    expect(result.current.isReady).toBe(false);

    // Simulate script load
    act(() => {
      appendedScripts[0].onload?.(new Event('load'));
    });

    expect(result.current.isReady).toBe(true);
  });

  it('sets isReady=true immediately if SDK is already loaded', () => {
    // Pre-load the SDK
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: {
        auth: vi.fn(),
        init: vi.fn(),
        open: vi.fn(),
      },
    };

    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    expect(result.current.isReady).toBe(true);
    // Should not inject another script
    expect(appendedScripts.length).toBe(0);
  });

  it('removes script on unmount', () => {
    const { unmount } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    expect(appendedScripts.length).toBe(1);

    unmount();

    // removeChild should have been called
    expect(document.head.removeChild).toHaveBeenCalled();
  });

  it('patches window.open to inject origin into Telegram auth popup URL', () => {
    const mockAuth = vi.fn().mockImplementation(() => {
      // Simulate what the SDK does: call window.open with the auth URL
      const popup = window.open(
        'https://oauth.telegram.org/auth?response_type=post_message&client_id=123456789',
        'telegram_oidc_login',
        'width=550,height=650',
      );
      // Capture the URL that was actually passed through our patch
      void popup; // not used in test
    });

    // Spy on window.open to capture the final URL
    const openSpy = vi.fn().mockReturnValue(null);
    window.open = openSpy;

    (window as unknown as Record<string, unknown>).Telegram = {
      Login: {
        auth: mockAuth,
        init: vi.fn(),
        open: vi.fn(),
      },
    };

    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    // The auth mock was called, which in turn called our patched window.open.
    // The patched window.open should have injected &origin= into the URL.
    // But we need to check what the *final* open received.
    // Since mockAuth simulates the SDK calling window.open, and our hook
    // patches window.open before calling auth(), the mock should see the patched version.
    expect(mockAuth).toHaveBeenCalled();

    // After triggerLogin, window.open should be restored (finally block)
    // The openSpy was set before mockAuth ran, so it captured the patched call
    const capturedUrl = openSpy.mock.calls[0]?.[0] as string;
    expect(capturedUrl).toContain('origin=');
    expect(capturedUrl).toContain(encodeURIComponent('http://localhost:3000'));
  });

  it('triggerLogin calls Telegram.Login.auth with client_id (not bot_id)', () => {
    const mockAuth = vi.fn();
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: { auth: mockAuth, init: vi.fn(), open: vi.fn() },
    };

    const { result } = renderHook(() =>
      useTelegramLogin({ botId, onAuth: mockOnAuth, lang: 'he' }),
    );

    act(() => {
      result.current.triggerLogin();
    });

    expect(mockAuth).toHaveBeenCalledWith(
      { client_id: botId, request_access: 'write', lang: 'he' },
      expect.any(Function),
    );
  });

  it('triggerLogin calls onAuth when Telegram returns a result with id_token', () => {
    const mockAuth = vi.fn();
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: { auth: mockAuth, init: vi.fn(), open: vi.fn() },
    };

    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    // Get the callback passed to Telegram.Login.auth
    const callback = mockAuth.mock.calls[0][1] as (
      result: TelegramLoginResult | { error: string },
    ) => void;

    act(() => {
      callback({ id_token: 'test-jwt-token' });
    });

    expect(mockOnAuth).toHaveBeenCalledWith({ id_token: 'test-jwt-token' });
    expect(result.current.isLoading).toBe(false);
  });

  it('triggerLogin calls onError when SDK returns an error object', () => {
    const mockAuth = vi.fn();
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: { auth: mockAuth, init: vi.fn(), open: vi.fn() },
    };

    const { result } = renderHook(() =>
      useTelegramLogin({ botId, onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => {
      result.current.triggerLogin();
    });

    const callback = mockAuth.mock.calls[0][1] as (
      result: TelegramLoginResult | { error: string },
    ) => void;

    act(() => {
      callback({ error: 'user_cancelled' });
    });

    expect(mockOnError).toHaveBeenCalled();
    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('sets isLoading=true while auth popup is open', () => {
    const mockAuth = vi.fn();
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: { auth: mockAuth, init: vi.fn(), open: vi.fn() },
    };

    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('does nothing when triggerLogin is called without SDK loaded', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    // SDK not loaded yet, triggerLogin should be a no-op
    act(() => {
      result.current.triggerLogin();
    });

    expect(mockOnAuth).not.toHaveBeenCalled();
  });

  it('recovers from auth() throwing an error', () => {
    const mockAuth = vi.fn().mockImplementation(() => {
      throw new Error('client_id is required');
    });
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: { auth: mockAuth, init: vi.fn(), open: vi.fn() },
    };

    const { result } = renderHook(() =>
      useTelegramLogin({ botId, onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => {
      result.current.triggerLogin();
    });

    // Should recover: isLoading back to false, onError called
    expect(result.current.isLoading).toBe(false);
    expect(mockOnError).toHaveBeenCalled();
    expect(mockOnAuth).not.toHaveBeenCalled();
  });

  it('restores window.open after triggerLogin (no longer patched)', () => {
    const mockAuth = vi.fn();
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: { auth: mockAuth, init: vi.fn(), open: vi.fn() },
    };

    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    // After triggerLogin, window.open should no longer be the patched version.
    // Verify by calling it with a non-Telegram URL and checking it's not modified.
    expect(window.open.name).not.toBe('patchedOpen');
  });
});
