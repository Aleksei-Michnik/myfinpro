'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Response from the Telegram OIDC popup flow.
 * Contains an OIDC JWT `id_token`.
 */
export interface TelegramLoginResult {
  id_token: string;
}

/**
 * Error response from the Telegram popup flow.
 * Returned when the user cancels or auth fails.
 */
interface TelegramLoginError {
  error: string;
}

/** The popup callback receives either a success result or an error object. */
type TelegramAuthCallbackResult = TelegramLoginResult | TelegramLoginError;

// ── Constants ────────────────────────────────────────────────────────────────
const OIDC_ORIGIN = 'https://oauth.telegram.org';
const OIDC_AUTH_URL = OIDC_ORIGIN + '/auth';
const POPUP_CHECK_INTERVAL_MS = 300;

// ── Helpers (replicated from SDK's buildResult) ─────────────────────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4;
    if (pad) payload += '='.repeat(4 - pad);
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function buildResult(data: Record<string, unknown>): TelegramAuthCallbackResult {
  if (data.error) {
    return { error: String(data.error) };
  }
  const idToken = data.result;
  if (!idToken || typeof idToken !== 'string') {
    return { error: 'missing id_token' };
  }
  const user = decodeJwtPayload(idToken);
  if (!user) {
    return { error: 'malformed id_token' };
  }
  return { id_token: idToken };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

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
 * Hook that opens the Telegram Login OIDC popup directly (without relying on the
 * Telegram Login SDK's internal message handler, which has a race condition between
 * its close-checker and postMessage delivery).
 *
 * We construct the popup URL ourselves, open it with `window.open`, and listen for
 * the `postMessage` result directly. This gives us full control over the popup
 * reference and message handling.
 *
 * Usage:
 * ```tsx
 * const { triggerLogin, isLoading } = useTelegramLogin({
 *   botId: '123456789',
 *   onAuth: (result) => loginWithTelegram(result),
 * });
 * ```
 */
export function useTelegramLogin({ botId, onAuth, onError, lang }: UseTelegramLoginOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const popupRef = useRef<WindowProxy | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Keep callbacks in refs to avoid re-triggering the effect
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const triggerLogin = useCallback(() => {
    if (!botId) return;

    // Prevent double-opening while a popup is already active
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }

    setIsLoading(true);

    // ── Build the auth URL (same as SDK v3, but with `origin`) ──────────
    const scopes = ['openid', 'profile', 'telegram:bot_access'];
    const redirectUri = window.location.origin + window.location.pathname;

    let authUrl =
      OIDC_AUTH_URL +
      '?response_type=post_message' +
      '&client_id=' +
      encodeURIComponent(botId) +
      '&redirect_uri=' +
      encodeURIComponent(redirectUri) +
      '&scope=' +
      encodeURIComponent(scopes.join(' ')) +
      '&origin=' +
      encodeURIComponent(window.location.origin);

    if (lang) {
      authUrl += '&lang=' + encodeURIComponent(lang);
    }

    // ── Popup window geometry ───────────────────────────────────────────
    const width = 550;
    const height = 650;
    const screenAny = screen as unknown as Record<string, number>;
    const left = Math.max(0, (screen.width - width) / 2) + (screenAny.availLeft || 0);
    const top = Math.max(0, (screen.height - height) / 2) + (screenAny.availTop || 0);
    const features =
      'width=' +
      width +
      ',height=' +
      height +
      ',left=' +
      left +
      ',top=' +
      top +
      ',status=0,location=0,menubar=0,toolbar=0';

    // ── Guard: prevent duplicate listeners from prior abandoned popups ──
    cleanupRef.current?.();

    // ── State for this popup session ────────────────────────────────────
    let finished = false;

    const finish = (result: TelegramAuthCallbackResult) => {
      if (finished) return;
      finished = true;
      cleanup();
      setIsLoading(false);

      if ('error' in result) {
        onErrorRef.current?.();
      } else {
        onAuthRef.current(result);
      }
    };

    // ── Message handler ─────────────────────────────────────────────────
    const onMessage = (event: MessageEvent) => {
      // Only accept messages from the Telegram auth origin
      if (event.origin !== OIDC_ORIGIN) return;

      let data: Record<string, unknown>;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }

      if (data && data.event === 'auth_result') {
        finish(buildResult(data));
      }
    };

    // ── Close-checker (fires only if the user closes the popup) ─────────
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    const checkClose = () => {
      if (!popupRef.current || popupRef.current.closed) {
        if (!finished) {
          finish({ error: 'popup_closed' });
        }
        return;
      }
      closeTimer = setTimeout(checkClose, POPUP_CHECK_INTERVAL_MS);
    };

    // ── Cleanup ─────────────────────────────────────────────────────────
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (closeTimer !== null) clearTimeout(closeTimer);
      popupRef.current = null;
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;

    // ── Open popup ──────────────────────────────────────────────────────
    window.addEventListener('message', onMessage);
    popupRef.current = window.open(authUrl, 'telegram_oidc_login', features);

    if (popupRef.current) {
      popupRef.current.focus();
      checkClose();
    } else {
      // Popup blocked — fall back: the message listener is still active,
      // so if the browser opened it as a tab we'll still receive the result.
      // Start close-checking anyway (it'll no-op since ref is null).
    }
  }, [botId, lang]);

  // isReady is always true — we no longer depend on loading an external SDK script.
  return { triggerLogin, isReady: !!botId, isLoading };
}
