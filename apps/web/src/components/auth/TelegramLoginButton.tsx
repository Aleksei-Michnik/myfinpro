'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Telegram Login Widget hash-based auth result.
 *
 * Telegram does NOT support native OIDC — the Login SDK v3 returns
 * the classic hash-based user data: `{ id, first_name, auth_date, hash, ... }`.
 * The hash is HMAC-SHA256 of the data fields using the bot token as key.
 *
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export interface TelegramLoginResult {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function isErrorResult(data: unknown): data is TelegramLoginError {
  return typeof data === 'object' && data !== null && 'error' in data;
}

function buildResult(data: Record<string, unknown>): TelegramAuthCallbackResult {
  if (data.error) {
    return { error: String(data.error) };
  }

  const result = data.result;

  // Telegram returns result as an object with { id, first_name, auth_date, hash, ... }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    if (
      typeof r.id === 'number' &&
      typeof r.first_name === 'string' &&
      typeof r.hash === 'string' &&
      typeof r.auth_date === 'number'
    ) {
      return {
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name as string | undefined,
        username: r.username as string | undefined,
        photo_url: r.photo_url as string | undefined,
        auth_date: r.auth_date,
        hash: r.hash,
      };
    }
  }

  return { error: 'invalid auth result' };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseTelegramLoginOptions {
  /** Numeric bot ID (first part of bot token). */
  botId: string;
  /** Called with the auth result on successful authentication. */
  onAuth: (result: TelegramLoginResult) => void;
  /** Called when user cancels or auth fails. */
  onError?: () => void;
  /** Language code for the Telegram popup (e.g., 'en', 'he'). */
  lang?: string;
}

/**
 * Hook that opens the Telegram Login popup directly (without relying on the
 * Telegram Login SDK's internal message handler).
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

    // ── Build the auth URL ───────────────────────────────────────────────
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

      if (isErrorResult(result)) {
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
    }
  }, [botId, lang]);

  // isReady is always true — we no longer depend on loading an external SDK script.
  return { triggerLogin, isReady: !!botId, isLoading };
}
