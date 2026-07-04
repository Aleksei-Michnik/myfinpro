// Phase 6 · Iteration 6.18.1.4 — DRY auth cookie helper.
//
// The SSE endpoint (and any future cookie-authenticated endpoint) needs the
// JWT in an `access_token` cookie because EventSource cannot set custom
// headers. This helper centralises the cookie attributes so login,
// register, refresh, OAuth callback, and logout all stay in sync.
//
// The existing `Authorization: Bearer` flow is unchanged — the cookie is
// purely additive.

import { Response } from 'express';

const COOKIE_NAME = 'access_token';

/** Default to 15 minutes — matches the access-token JWT TTL. */
export const DEFAULT_ACCESS_COOKIE_MAX_AGE_SECONDS = 15 * 60;

/** True only in production — staging/dev/test set Secure=false so curl works. */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Set the `access_token` cookie alongside the JSON body that exposes it. */
export function setAuthCookie(
  response: Response,
  jwt: string,
  maxAgeSeconds: number = DEFAULT_ACCESS_COOKIE_MAX_AGE_SECONDS,
): void {
  response.cookie(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

/** Clear the cookie on logout / account deletion. */
export function clearAuthCookie(response: Response): void {
  response.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
  });
}

// ── Provider-link cookie ──
//
// GET /auth/google/link stores a short-lived, single-purpose JWT here so
// the Google OAuth callback (a top-level redirect that carries no
// Authorization header) knows to LINK the Google identity to the already
// authenticated user instead of running the login flow. SameSite=Lax
// cookies are sent on the top-level redirect back from Google.

const LINK_COOKIE_NAME = 'link_token';

/** Matches the 10-minute TTL of the link JWT itself. */
export const LINK_TOKEN_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export function setLinkTokenCookie(response: Response, jwt: string): void {
  response.cookie(LINK_COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: LINK_TOKEN_COOKIE_MAX_AGE_SECONDS * 1000,
  });
}

export function clearLinkTokenCookie(response: Response): void {
  response.clearCookie(LINK_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
  });
}
