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

  it('triggerLogin calls Telegram.Login.auth with correct options', () => {
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
      { bot_id: botId, request_access: 'write', lang: 'he' },
      expect.any(Function),
    );
  });

  it('triggerLogin calls onAuth when Telegram returns a result', () => {
    const mockAuth = vi.fn();
    (window as unknown as Record<string, unknown>).Telegram = {
      Login: { auth: mockAuth, init: vi.fn(), open: vi.fn() },
    };

    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    // Get the callback passed to Telegram.Login.auth
    const callback = mockAuth.mock.calls[0][1] as (result: TelegramLoginResult | false) => void;

    act(() => {
      callback({ id_token: 'test-jwt-token' });
    });

    expect(mockOnAuth).toHaveBeenCalledWith({ id_token: 'test-jwt-token' });
    expect(result.current.isLoading).toBe(false);
  });

  it('triggerLogin calls onError when user cancels (result is false)', () => {
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

    const callback = mockAuth.mock.calls[0][1] as (result: TelegramLoginResult | false) => void;

    act(() => {
      callback(false);
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
});
