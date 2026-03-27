import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Telegram OIDC JWT claims returned by the Telegram Login SDK.
 *
 * @see https://core.telegram.org/widgets/login (OIDC JWT section)
 */
export interface TelegramJwtClaims extends JWTPayload {
  /** Telegram user ID (numeric, as string in `sub`) */
  sub: string;
  /** First name */
  first_name: string;
  /** Last name (optional) */
  last_name?: string;
  /** Telegram username (optional) */
  username?: string;
  /** Profile photo URL (optional) */
  photo_url?: string;
}

/** Telegram's JWKS endpoint for verifying id_token signatures. */
const TELEGRAM_JWKS_URL = new URL('https://oauth.telegram.org/.well-known/jwks.json');

/** Cached JWKS fetcher — `jose` handles key rotation and caching internally. */
const telegramJWKS = createRemoteJWKSet(TELEGRAM_JWKS_URL);

/**
 * Verifies a Telegram Login SDK `id_token` (OIDC JWT) using Telegram's JWKS.
 *
 * @param idToken - The raw JWT string from the Telegram Login SDK
 * @param botId - The numeric bot ID (first part of bot token, e.g. "123456789")
 * @returns Verified JWT claims including Telegram user profile data
 * @throws If the token is invalid, expired, or has wrong audience
 */
export async function verifyTelegramIdToken(
  idToken: string,
  botId: string,
): Promise<TelegramJwtClaims> {
  const { payload } = await jwtVerify(idToken, telegramJWKS, {
    issuer: 'https://oauth.telegram.org',
    audience: botId,
  });

  // Validate required claims
  if (!payload.sub) {
    throw new Error('Missing sub claim in Telegram id_token');
  }
  if (!(payload as TelegramJwtClaims).first_name) {
    throw new Error('Missing first_name claim in Telegram id_token');
  }

  return payload as TelegramJwtClaims;
}
