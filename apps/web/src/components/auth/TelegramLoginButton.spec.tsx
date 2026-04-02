import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTelegramLogin, type TelegramLoginResult } from './TelegramLoginButton';

describe('useTelegramLogin', () => {
  const mockOnAuth = vi.fn();
  const mockOnError = vi.fn();
  const botId = '123456789';

  let openSpy: ReturnType<typeof vi.fn>;
  let addEventSpy: ReturnType<typeof vi.spyOn>;
  let removeEventSpy: ReturnType<typeof vi.spyOn>;

  /** Extract the `message` event handler registered via addEventListener spy. */
  function getMessageHandler(): (event: MessageEvent) => void {
    const calls = addEventSpy.mock.calls as unknown as [string, EventListener][];
    const msgCall = calls.find(([type]) => type === 'message');
    if (!msgCall) throw new Error('No message listener was registered');
    return msgCall[1] as (event: MessageEvent) => void;
  }

  /** Check whether removeEventListener was called for the `message` event. */
  function wasMessageListenerRemoved(): boolean {
    const calls = removeEventSpy.mock.calls as unknown as [string, EventListener][];
    return calls.some(([type]) => type === 'message');
  }

  /** A valid JWT with 3 dot-separated base64 parts for buildResult to parse. */
  const STUB_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.stub-signature';

  /** Helper to create a Telegram auth_result MessageEvent */
  function makeTelegramAuthEvent(
    data: Record<string, unknown>,
    origin = 'https://oauth.telegram.org',
  ): MessageEvent {
    return new MessageEvent('message', {
      origin,
      data: JSON.stringify(data),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock window.open to return a mock popup
    openSpy = vi.fn().mockReturnValue({
      closed: false,
      focus: vi.fn(),
      close: vi.fn(),
    });
    vi.stubGlobal('open', openSpy);

    addEventSpy = vi.spyOn(window, 'addEventListener');
    removeEventSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens popup with correct Telegram OIDC URL including origin', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toContain('https://oauth.telegram.org/auth?');
    expect(url).toContain('response_type=post_message');
    expect(url).toContain('client_id=' + encodeURIComponent(botId));
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('scope=');
    expect(url).toContain('origin=' + encodeURIComponent('http://localhost:3000'));
  });

  it('includes lang parameter when provided', () => {
    const { result } = renderHook(() =>
      useTelegramLogin({ botId, onAuth: mockOnAuth, lang: 'he' }),
    );

    act(() => {
      result.current.triggerLogin();
    });

    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toContain('lang=he');
  });

  it('opens popup with correct window name and features', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    expect(openSpy.mock.calls[0][1]).toBe('telegram_oidc_login');
    const features = openSpy.mock.calls[0][2] as string;
    expect(features).toContain('width=550');
    expect(features).toContain('height=650');
  });

  it('sets isLoading=true while popup is open', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    expect(result.current.isLoading).toBe(false);

    act(() => {
      result.current.triggerLogin();
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('registers a message event listener before opening popup', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    // Should not throw — a message listener was registered
    expect(() => getMessageHandler()).not.toThrow();
  });

  it('calls onAuth when receiving auth_result postMessage from oauth.telegram.org', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    const handler = getMessageHandler();

    act(() => {
      handler(makeTelegramAuthEvent({ event: 'auth_result', result: STUB_JWT }));
    });

    expect(mockOnAuth).toHaveBeenCalledTimes(1);
    expect(mockOnAuth.mock.calls[0][0]).toHaveProperty('id_token');
    expect(result.current.isLoading).toBe(false);
  });

  it('calls onError when receiving auth_result with error from oauth.telegram.org', () => {
    const { result } = renderHook(() =>
      useTelegramLogin({ botId, onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => {
      result.current.triggerLogin();
    });

    const handler = getMessageHandler();

    act(() => {
      handler(makeTelegramAuthEvent({ event: 'auth_result', error: 'user_cancelled' }));
    });

    expect(mockOnError).toHaveBeenCalledTimes(1);
    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('ignores postMessage from non-Telegram origins', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    const handler = getMessageHandler();

    act(() => {
      handler(
        makeTelegramAuthEvent(
          { event: 'auth_result', result: STUB_JWT },
          'https://evil.example.com',
        ),
      );
    });

    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true); // still loading
  });

  it('calls onError when popup is closed without auth result', () => {
    const mockPopup = { closed: false, focus: vi.fn(), close: vi.fn() };
    openSpy.mockReturnValue(mockPopup);

    const { result } = renderHook(() =>
      useTelegramLogin({ botId, onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => {
      result.current.triggerLogin();
    });

    expect(result.current.isLoading).toBe(true);

    // Simulate popup closing
    mockPopup.closed = true;
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockOnError).toHaveBeenCalledTimes(1);
    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('removes message listener after receiving result', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    const handler = getMessageHandler();

    act(() => {
      handler(makeTelegramAuthEvent({ event: 'auth_result', result: STUB_JWT }));
    });

    expect(wasMessageListenerRemoved()).toBe(true);
  });

  it('does nothing when botId is empty', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId: '', onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    expect(openSpy).not.toHaveBeenCalled();
    expect(result.current.isReady).toBe(false);
  });

  it('isReady is true when botId is provided', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    expect(result.current.isReady).toBe(true);
  });

  it('focuses existing popup if triggerLogin called while popup is open', () => {
    const mockPopup = { closed: false, focus: vi.fn(), close: vi.fn() };
    openSpy.mockReturnValue(mockPopup);

    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    // Second call — popup is still open
    act(() => {
      result.current.triggerLogin();
    });

    // window.open called only once, popup focused twice (initial + re-click)
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(mockPopup.focus).toHaveBeenCalledTimes(2);
  });

  it('does not call callbacks twice (finish guard)', () => {
    const mockPopup = { closed: false, focus: vi.fn(), close: vi.fn() };
    openSpy.mockReturnValue(mockPopup);

    const { result } = renderHook(() =>
      useTelegramLogin({ botId, onAuth: mockOnAuth, onError: mockOnError }),
    );

    act(() => {
      result.current.triggerLogin();
    });

    const handler = getMessageHandler();

    // First: success result via postMessage
    act(() => {
      handler(makeTelegramAuthEvent({ event: 'auth_result', result: STUB_JWT }));
    });

    // Then: popup closes (would fire error, but finish guard prevents it)
    mockPopup.closed = true;
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockOnAuth).toHaveBeenCalledTimes(1);
    expect(mockOnError).not.toHaveBeenCalled();
  });

  it('handles non-JSON postMessage data gracefully', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    const handler = getMessageHandler();

    // Send non-JSON string — should not throw
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: 'not-json-data',
        }),
      );
    });

    expect(mockOnAuth).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true); // still loading
  });

  it('handles object postMessage data (not just string)', () => {
    const { result } = renderHook(() => useTelegramLogin({ botId, onAuth: mockOnAuth }));

    act(() => {
      result.current.triggerLogin();
    });

    const handler = getMessageHandler();

    // Send data as object (some browsers pass objects directly)
    act(() => {
      handler(
        new MessageEvent('message', {
          origin: 'https://oauth.telegram.org',
          data: { event: 'auth_result', result: STUB_JWT },
        }),
      );
    });

    expect(mockOnAuth).toHaveBeenCalledTimes(1);
  });
});
