import { createHash, createHmac } from 'crypto';
import type { TelegramAuthDto } from '../dto/telegram-auth.dto';

/**
 * Verified Telegram user profile extracted from the hash-based auth data.
 */
export interface TelegramAuthData {
  /** Telegram user ID (as string for consistency with OAuth provider IDs) */
  telegramId: string;
  /** First name */
  firstName: string;
  /** Last name (optional) */
  lastName?: string;
  /** Telegram username (optional) */
  username?: string;
  /** Profile photo URL (optional) */
  photoUrl?: string;
}

/** Maximum age of auth_date before we consider it stale (24 hours). */
const MAX_AUTH_AGE_SECONDS = 86400;

/**
 * Verifies Telegram Login Widget data using HMAC-SHA256.
 *
 * The verification algorithm:
 * 1. Sort all fields (except `hash`) alphabetically as `key=value` pairs
 * 2. Join them with `\n`
 * 3. Create a SHA-256 hash of the bot token (this is the secret key)
 * 4. Compute HMAC-SHA256 of the data string using the secret key
 * 5. Compare with the provided `hash`
 *
 * @param dto - The Telegram auth data from the frontend
 * @param botToken - The full bot token (e.g. "123456789:ABCdefGHI...")
 * @returns Verified user profile data
 * @throws If the hash is invalid, data is stale, or required fields are missing
 *
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(dto: TelegramAuthDto, botToken: string): TelegramAuthData {
  // 1. Check auth_date freshness
  const now = Math.floor(Date.now() / 1000);
  if (now - dto.auth_date > MAX_AUTH_AGE_SECONDS) {
    throw new Error('Telegram auth data is too old');
  }

  // 2. Build the data-check-string: sort fields alphabetically, join with \n
  const checkData: Record<string, string | number> = {
    id: dto.id,
    first_name: dto.first_name,
    auth_date: dto.auth_date,
  };
  if (dto.last_name) checkData.last_name = dto.last_name;
  if (dto.username) checkData.username = dto.username;
  if (dto.photo_url) checkData.photo_url = dto.photo_url;

  const dataCheckString = Object.keys(checkData)
    .sort()
    .map((key) => `${key}=${checkData[key]}`)
    .join('\n');

  // 3. Create secret key: SHA-256 of the bot token
  const secretKey = createHash('sha256').update(botToken).digest();

  // 4. Compute HMAC-SHA256
  const hmac = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // 5. Compare hashes (constant-time comparison via string equality on hex)
  if (hmac !== dto.hash) {
    throw new Error('Invalid Telegram auth hash');
  }

  return {
    telegramId: String(dto.id),
    firstName: dto.first_name,
    lastName: dto.last_name,
    username: dto.username,
    photoUrl: dto.photo_url,
  };
}
