import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTelegramLogin, type TelegramLoginResult } from './TelegramLoginButton';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fully fictional stub matching the Telegram hash-based auth result format */
const STUB_TELEGRAM_RESULT: TelegramLoginResult = {
  id: 111222333,
  first_name: 'Test',
  username: 'testuser',
  photo_url: 'https://t.me/i/userpic/320/test.jpg',
  auth_date: 1700000000,
  hash: 'aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb',
};

function getMessageHandler(): EventListener | undefined {
  const calls = (
    window.addEventListener as unknown as { mock: { calls: [string, EventListener][] } }
  ).mock.calls;
  const messageCall = calls.find(([event]) => event === 'message');
  return messageCall?.[1];
}

function wasMessageListenerRemoved(): boolean {
  const calls = (
    window.removeEventListener as unknown as { mock: { calls: [string, EventListener][] } }
  ).mock.calls;
  return calls.some(([event]) => event === 'message');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useTelegramLogin', () => {
  let openSpy: ReturnType<typeof vi.fn>;
  let mockPopup: {
    closed: boolean;
    focus: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockPopup = { closed: false, focus: vi.fn(), close: vi.fn() };
    openSpy = vi.fn().mockReturnValue(mockPopup);
    vi.stubGlobal('open', openSpy);
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens popup with correct Telegram auth URL including origin', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '123456789', onAuth: vi.fn() }));

    act(() => result.current.triggerLogin());

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toContain('https://oauth.telegram.org/auth?');
    expect(url).toContain('response_type=post_message');
    expect(url).toContain('client_id=123456789');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('scope=');
    expect(url).toContain('origin=http%3A%2F%2Flocalhost%3A3000');
  });

  it('includes lang parameter when provided', () => {
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: vi.fn(), lang: 'he' }),
    );

    act(() => result.current.triggerLogin());

    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toContain('lang=he');
  });

  it('opens popup with correct window name and features', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '123456789', onAuth: vi.fn() }));

    act(() => result.current.triggerLogin());

    expect(openSpy.mock.calls[0][1]).toBe('telegram_oidc_login');
    const features = openSpy.mock.calls[0][2] as string;
    expect(features).toContain('width=550');
    expect(features).toContain('height=650');
  });

  it('sets isLoading=true while popup is open', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '123456789', onAuth: vi.fn() }));

    expect(result.current.isLoading).toBe(false);
    act(() => result.current.triggerLogin());
    expect(result.current.isLoading).toBe(true);
  });

  it('registers a message event listener before opening popup', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '123456789', onAuth: vi.fn() }));

    act(() => result.current.triggerLogin());

    expect(window.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('calls onAuth when receiving auth_result postMessage with hash-based data', () => {
    const mockOnAuth = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: mockOnAuth }),
    );

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: JSON.stringify({
            event: 'auth_result',
            result: STUB_TELEGRAM_RESULT,
          }),
        }),
      );
    });

    expect(mockOnAuth).toHaveBeenCalledTimes(1);
    expect(mockOnAuth.mock.calls[0][0]).toHaveProperty('id', 111222333);
    expect(mockOnAuth.mock.calls[0][0]).toHaveProperty('first_name', 'Test');
    expect(mockOnAuth.mock.calls[0][0]).toHaveProperty('hash');
    expect(mockOnAuth.mock.calls[0][0]).toHaveProperty('auth_date');
    expect(result.current.isLoading).toBe(false);
  });

  it('calls onError when receiving auth_result with error from oauth.telegram.org', () => {
    const mockOnAuth = vi.fn();
    const mockOnError = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: JSON.stringify({ event: 'auth_result', error: 'user_cancelled' }),
        }),
      );
    });

    expect(mockOnError).toHaveBeenCalledTimes(1);
    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('ignores postMessage from non-Telegram origins', () => {
    const mockOnAuth = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: mockOnAuth }),
    );

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://evil.example.com',
          data: JSON.stringify({
            event: 'auth_result',
            result: STUB_TELEGRAM_RESULT,
          }),
        }),
      );
    });

    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
  });

  it('calls onError when popup is closed without auth result', () => {
    const mockOnError = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: vi.fn(), onError: mockOnError }),
    );

    act(() => result.current.triggerLogin());

    // Simulate popup closing
    mockPopup.closed = true;
    act(() => {
      vi.advanceTimersByTime(POPUP_CHECK_INTERVAL_MS);
    });

    expect(mockOnError).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('removes message listener after receiving result', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '123456789', onAuth: vi.fn() }));

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: JSON.stringify({
            event: 'auth_result',
            result: STUB_TELEGRAM_RESULT,
          }),
        }),
      );
    });

    expect(wasMessageListenerRemoved()).toBe(true);
  });

  it('does nothing when botId is empty', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '', onAuth: vi.fn() }));

    act(() => result.current.triggerLogin());

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('isReady is true when botId is provided', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '123456789', onAuth: vi.fn() }));

    expect(result.current.isReady).toBe(true);
  });

  it('focuses existing popup if triggerLogin called while popup is open', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '123456789', onAuth: vi.fn() }));

    act(() => result.current.triggerLogin());
    act(() => result.current.triggerLogin());

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(mockPopup.focus).toHaveBeenCalledTimes(2); // once on open, once on re-trigger
  });

  it('does not call callbacks twice (finish guard)', () => {
    const mockOnAuth = vi.fn();
    const mockOnError = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;

    // First: auth result
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: JSON.stringify({
            event: 'auth_result',
            result: STUB_TELEGRAM_RESULT,
          }),
        }),
      );
    });

    // Second: popup closes (should be ignored by finish guard)
    mockPopup.closed = true;
    act(() => {
      vi.advanceTimersByTime(POPUP_CHECK_INTERVAL_MS);
    });

    expect(mockOnAuth).toHaveBeenCalledTimes(1);
    expect(mockOnError).not.toHaveBeenCalled();
  });

  it('handles non-JSON postMessage data gracefully', () => {
    const mockOnAuth = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: mockOnAuth }),
    );

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: 'not-json-data',
        }),
      );
    });

    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
  });

  it('handles object postMessage data (not just string)', () => {
    const mockOnAuth = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: mockOnAuth }),
    );

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: {
            event: 'auth_result',
            result: STUB_TELEGRAM_RESULT,
          },
        }),
      );
    });

    expect(mockOnAuth).toHaveBeenCalledTimes(1);
    expect(mockOnAuth.mock.calls[0][0]).toHaveProperty('id', 111222333);
    expect(mockOnAuth.mock.calls[0][0]).toHaveProperty('hash');
  });

  it('calls onError when result is missing required fields', () => {
    const mockOnAuth = vi.fn();
    const mockOnError = vi.fn();
    const { result } = renderHook(() =>
      useTelegramLogin({ botId: '123456789', onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => result.current.triggerLogin());

    const handler = getMessageHandler()!;
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: JSON.stringify({
            event: 'auth_result',
            result: { id: 111222333 }, // missing first_name, hash, auth_date
          }),
        }),
      );
    });

    expect(mockOnError).toHaveBeenCalledTimes(1);
    expect(mockOnAuth).not.toHaveBeenCalled();
  });

  const POPUP_CHECK_INTERVAL_MS = 300;
});
