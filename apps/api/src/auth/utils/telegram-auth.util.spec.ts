import { createHash, createHmac } from 'crypto';
import type { TelegramAuthDto } from '../dto/telegram-auth.dto';
import { verifyTelegramAuth, TelegramAuthData } from './telegram-auth.util';

/**
 * Helper: compute a valid HMAC-SHA256 hash for test data.
 */
function computeHash(data: Omit<TelegramAuthDto, 'hash'>, botToken: string): string {
  const checkData: Record<string, string | number> = {
    id: data.id,
    first_name: data.first_name,
    auth_date: data.auth_date,
  };
  if (data.last_name) checkData.last_name = data.last_name;
  if (data.username) checkData.username = data.username;
  if (data.photo_url) checkData.photo_url = data.photo_url;

  const dataCheckString = Object.keys(checkData)
    .sort()
    .map((key) => `${key}=${checkData[key]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

describe('telegram-auth.util', () => {
  const botToken = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
  const now = Math.floor(Date.now() / 1000);

  describe('verifyTelegramAuth()', () => {
    it('should return auth data for valid hash-based Telegram data', () => {
      const data: Omit<TelegramAuthDto, 'hash'> = {
        id: 987654321,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        photo_url: 'https://t.me/i/userpic/320/photo.jpg',
        auth_date: now,
      };
      const hash = computeHash(data, botToken);
      const dto: TelegramAuthDto = { ...data, hash };

      const result = verifyTelegramAuth(dto, botToken);

      expect(result).toEqual<TelegramAuthData>({
        telegramId: '987654321',
        firstName: 'John',
        lastName: 'Doe',
        username: 'johndoe',
        photoUrl: 'https://t.me/i/userpic/320/photo.jpg',
      });
    });

    it('should return auth data without optional fields', () => {
      const data: Omit<TelegramAuthDto, 'hash'> = {
        id: 987654321,
        first_name: 'Jane',
        auth_date: now,
      };
      const hash = computeHash(data, botToken);
      const dto: TelegramAuthDto = { ...data, hash };

      const result = verifyTelegramAuth(dto, botToken);

      expect(result.telegramId).toBe('987654321');
      expect(result.firstName).toBe('Jane');
      expect(result.lastName).toBeUndefined();
      expect(result.username).toBeUndefined();
      expect(result.photoUrl).toBeUndefined();
    });

    it('should throw when hash is invalid (tampered data)', () => {
      const data: Omit<TelegramAuthDto, 'hash'> = {
        id: 987654321,
        first_name: 'John',
        auth_date: now,
      };
      const dto: TelegramAuthDto = { ...data, hash: 'invalid_hash_value' };

      expect(() => verifyTelegramAuth(dto, botToken)).toThrow('Invalid Telegram auth hash');
    });

    it('should throw when auth_date is too old (stale data)', () => {
      const staleDate = now - 86401; // 24 hours + 1 second ago
      const data: Omit<TelegramAuthDto, 'hash'> = {
        id: 987654321,
        first_name: 'John',
        auth_date: staleDate,
      };
      const hash = computeHash(data, botToken);
      const dto: TelegramAuthDto = { ...data, hash };

      expect(() => verifyTelegramAuth(dto, botToken)).toThrow('Telegram auth data is too old');
    });

    it('should throw when hash was computed with wrong bot token', () => {
      const data: Omit<TelegramAuthDto, 'hash'> = {
        id: 987654321,
        first_name: 'John',
        auth_date: now,
      };
      const hash = computeHash(data, 'wrong_bot_token:ABC');
      const dto: TelegramAuthDto = { ...data, hash };

      expect(() => verifyTelegramAuth(dto, botToken)).toThrow('Invalid Telegram auth hash');
    });

    it('should throw when data fields are modified after hashing', () => {
      const data: Omit<TelegramAuthDto, 'hash'> = {
        id: 987654321,
        first_name: 'John',
        auth_date: now,
      };
      const hash = computeHash(data, botToken);
      // Tamper with the first_name after computing hash
      const dto: TelegramAuthDto = { ...data, first_name: 'Hacker', hash };

      expect(() => verifyTelegramAuth(dto, botToken)).toThrow('Invalid Telegram auth hash');
    });

    it('should accept data within the 24-hour window', () => {
      const recentDate = now - 3600; // 1 hour ago
      const data: Omit<TelegramAuthDto, 'hash'> = {
        id: 987654321,
        first_name: 'John',
        auth_date: recentDate,
      };
      const hash = computeHash(data, botToken);
      const dto: TelegramAuthDto = { ...data, hash };

      const result = verifyTelegramAuth(dto, botToken);
      expect(result.telegramId).toBe('987654321');
    });
  });
});
