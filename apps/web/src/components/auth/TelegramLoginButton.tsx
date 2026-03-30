'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Response from the Telegram Login SDK `Telegram.Login.auth()` callback.
 * Contains an OIDC JWT `id_token`.
 */
export interface TelegramLoginResult {
  id_token: string;
}

/**
 * Error response from the Telegram Login SDK callback.
 * Returned when the user cancels or auth fails.
 */
interface TelegramLoginError {
  error: string;
}

/** The SDK callback receives either a success result or an error object. */
type TelegramAuthCallbackResult = TelegramLoginResult | TelegramLoginError;

/** Global type augmentation for the Telegram Login SDK. */
declare global {
  interface Window {
    Telegram?: {
      Login: {
        auth: (
          options: { client_id: string; request_access?: string; lang?: string },
          callback: (result: TelegramAuthCallbackResult) => void,
        ) => void;
        init: (options: { client_id: string }) => void;
        open: (callback: (result: TelegramAuthCallbackResult) => void) => void;
      };
    };
  }
}

const TELEGRAM_SDK_URL = 'https://oauth.telegram.org/js/telegram-login.js?3';

interface UseTelegramLoginOptions {
  /** Numeric bot ID (first part of bot token). */
  botId: string;
  /** Called with the id_token on successful authentication. */
  onAuth: (result: TelegramLoginResult) => void;
  /** Called when user cancels or auth fails. */
  onError?: () => void;
  /** Language code for the Telegram popup (e.g., 'en', 'he'). */
  lang?: string;
}

/**
 * Hook that loads the Telegram Login SDK and provides a `triggerLogin` function.
 *
 * Usage:
 * ```tsx
 * const { triggerLogin, isReady, isLoading } = useTelegramLogin({
 *   botId: '123456789',
 *   onAuth: (result) => loginWithTelegram(result),
 * });
 * ```
 */
export function useTelegramLogin({ botId, onAuth, onError, lang }: UseTelegramLoginOptions) {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  // Keep callbacks in refs to avoid re-triggering the effect
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!botId) return;

    // Check if SDK is already loaded
    if (window.Telegram?.Login) {
      setIsReady(true);
      return;
    }

    // Load the Telegram Login SDK script
    const script = document.createElement('script');
    script.src = TELEGRAM_SDK_URL;
    script.async = true;
    script.onload = () => {
      setIsReady(true);
    };
    script.onerror = () => {
      setIsReady(false);
    };
    document.head.appendChild(script);
    scriptRef.current = script;

    return () => {
      if (scriptRef.current && document.head.contains(scriptRef.current)) {
        document.head.removeChild(scriptRef.current);
      }
      scriptRef.current = null;
    };
  }, [botId]);

  const triggerLogin = useCallback(() => {
    if (!window.Telegram?.Login || !botId) return;

    setIsLoading(true);

    // WORKAROUND: The Telegram Login SDK v3 omits the `origin` query parameter
    // from the popup URL it constructs for the post_message flow. The Telegram
    // auth server requires `origin` and returns "origin required" without it.
    // We temporarily patch window.open to inject `&origin=` into the URL.
    const originalOpen = window.open.bind(window);
    window.open = function patchedOpen(
      url?: string | URL,
      target?: string,
      features?: string,
    ): WindowProxy | null {
      if (typeof url === 'string' && url.includes('oauth.telegram.org/auth')) {
        const separator = url.includes('?') ? '&' : '?';
        url = url + separator + 'origin=' + encodeURIComponent(window.location.origin);
      }
      return originalOpen(url, target, features);
    };

    try {
      window.Telegram.Login.auth(
        { client_id: botId, request_access: 'write', ...(lang ? { lang } : {}) },
        (result) => {
          setIsLoading(false);
          if ('error' in result) {
            onErrorRef.current?.();
          } else {
            onAuthRef.current(result);
          }
        },
      );
    } catch {
      setIsLoading(false);
      onErrorRef.current?.();
    } finally {
      // Restore original window.open — the SDK calls it synchronously
      // before any await, so this runs after the popup has already opened.
      window.open = originalOpen;
    }
  }, [botId, lang]);

  return { triggerLogin, isReady, isLoading };
}
