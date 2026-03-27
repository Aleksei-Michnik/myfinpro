import { createHash, createHmac } from 'crypto';

/**
 * Data received from Telegram Login Widget.
 * Field names use snake_case to match Telegram's API format.
 */
export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Verifies the HMAC-SHA256 hash per Telegram's Login Widget protocol.
 *
 * @see https://core.telegram.org/widgets/login#checking-authorization
 *
 * Steps:
 * 1. Sort all fields (except `hash`) alphabetically
 * 2. Create data-check-string: `key=value\n` pairs
 * 3. SHA-256 of bot token = secret key
 * 4. HMAC-SHA256 of data-check-string using secret key
 * 5. Compare with received hash
 */
export function verifyTelegramAuth(data: TelegramAuthData, botToken: string): boolean {
  const { hash, ...rest } = data;

  if (!hash || !botToken) {
    return false;
  }

  // 1. Sort fields alphabetically and create data-check-string
  const dataCheckString = Object.keys(rest)
    .sort()
    .filter((key) => rest[key as keyof typeof rest] !== undefined)
    .map((key) => `${key}=${rest[key as keyof typeof rest]}`)
    .join('\n');

  // 2. SHA-256 of bot token = secret key
  const secretKey = createHash('sha256').update(botToken).digest();

  // 3. HMAC-SHA256 of data-check-string using secret key
  const hmac = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // 4. Compare with received hash (constant-time comparison)
  return hmac === hash;
}

/**
 * Checks that auth_date is within the allowed time window.
 *
 * @param authDate - Unix timestamp from Telegram's auth_date field
 * @param maxAgeSeconds - Maximum age in seconds (default: 300 = 5 minutes)
 * @returns true if auth_date is recent enough
 */
export function isTelegramAuthRecent(authDate: number, maxAgeSeconds: number = 300): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - authDate <= maxAgeSeconds;
}
