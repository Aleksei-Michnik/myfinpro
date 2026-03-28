'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Response from the Telegram Login SDK `Telegram.Login.auth()` callback.
 * Contains an OIDC JWT `id_token`.
 */
export interface TelegramLoginResult {
  id_token: string;
}

/** Global type augmentation for the Telegram Login SDK. */
declare global {
  interface Window {
    Telegram?: {
      Login: {
        auth: (
          options: { bot_id: string; request_access?: string; lang?: string },
          callback: (result: TelegramLoginResult | false) => void,
        ) => void;
        init: (options: { bot_id: string }) => void;
        open: (callback: (result: TelegramLoginResult | false) => void) => void;
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
    console.log('[TelegramLogin] triggerLogin called', {
      sdkLoaded: !!window.Telegram?.Login,
      botId,
      authMethodExists: typeof window.Telegram?.Login?.auth,
    });
    if (!window.Telegram?.Login || !botId) {
      console.warn('[TelegramLogin] SDK not loaded or botId missing, aborting');
      return;
    }

    setIsLoading(true);
    try {
      console.log('[TelegramLogin] Calling Telegram.Login.auth with options:', {
        bot_id: botId,
        request_access: 'write',
        lang: lang || 'not set',
      });
      window.Telegram.Login.auth(
        { bot_id: botId, request_access: 'write', ...(lang ? { lang } : {}) },
        (result) => {
          console.log('[TelegramLogin] auth callback fired, result:', result);
          setIsLoading(false);
          if (result === false) {
            onErrorRef.current?.();
          } else {
            onAuthRef.current(result);
          }
        },
      );
    } catch (error) {
      console.error('[TelegramLogin] auth() threw an error:', error);
      setIsLoading(false);
      onErrorRef.current?.();
    }
  }, [botId, lang]);

  return { triggerLogin, isReady, isLoading };
}
