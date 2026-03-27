import { createHash, createHmac } from 'crypto';
import { TelegramAuthData, verifyTelegramAuth, isTelegramAuthRecent } from './telegram-auth.util';

/**
 * Helper: compute a valid HMAC hash for Telegram auth data.
 */
function computeTelegramHash(data: Omit<TelegramAuthData, 'hash'>, botToken: string): string {
  const dataCheckString = Object.keys(data)
    .sort()
    .filter((key) => data[key as keyof typeof data] !== undefined)
    .map((key) => `${key}=${data[key as keyof typeof data]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

describe('telegram-auth.util', () => {
  const botToken = 'test-bot-token:ABC123xyz';

  describe('verifyTelegramAuth()', () => {
    it('should return true for valid data with a correct HMAC', () => {
      const baseData: Omit<TelegramAuthData, 'hash'> = {
        id: 123456789,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        auth_date: 1700000000,
      };
      const hash = computeTelegramHash(baseData, botToken);
      const data: TelegramAuthData = { ...baseData, hash };

      expect(verifyTelegramAuth(data, botToken)).toBe(true);
    });

    it('should return true for valid data without optional fields', () => {
      const baseData: Omit<TelegramAuthData, 'hash'> = {
        id: 987654321,
        first_name: 'Jane',
        auth_date: 1700000000,
      };
      const hash = computeTelegramHash(baseData, botToken);
      const data: TelegramAuthData = { ...baseData, hash };

      expect(verifyTelegramAuth(data, botToken)).toBe(true);
    });

    it('should return true for data with photo_url', () => {
      const baseData: Omit<TelegramAuthData, 'hash'> = {
        id: 111222333,
        first_name: 'Alice',
        photo_url: 'https://t.me/i/userpic/320/photo.jpg',
        auth_date: 1700000000,
      };
      const hash = computeTelegramHash(baseData, botToken);
      const data: TelegramAuthData = { ...baseData, hash };

      expect(verifyTelegramAuth(data, botToken)).toBe(true);
    });

    it('should return false for tampered data (modified first_name)', () => {
      const baseData: Omit<TelegramAuthData, 'hash'> = {
        id: 123456789,
        first_name: 'John',
        auth_date: 1700000000,
      };
      const hash = computeTelegramHash(baseData, botToken);
      const tampered: TelegramAuthData = {
        ...baseData,
        first_name: 'Hacker',
        hash,
      };

      expect(verifyTelegramAuth(tampered, botToken)).toBe(false);
    });

    it('should return false for tampered data (modified id)', () => {
      const baseData: Omit<TelegramAuthData, 'hash'> = {
        id: 123456789,
        first_name: 'John',
        auth_date: 1700000000,
      };
      const hash = computeTelegramHash(baseData, botToken);
      const tampered: TelegramAuthData = {
        ...baseData,
        id: 999999999,
        hash,
      };

      expect(verifyTelegramAuth(tampered, botToken)).toBe(false);
    });

    it('should return false for wrong bot token', () => {
      const baseData: Omit<TelegramAuthData, 'hash'> = {
        id: 123456789,
        first_name: 'John',
        auth_date: 1700000000,
      };
      const hash = computeTelegramHash(baseData, botToken);
      const data: TelegramAuthData = { ...baseData, hash };

      expect(verifyTelegramAuth(data, 'wrong-bot-token')).toBe(false);
    });

    it('should return false for missing hash', () => {
      const data = {
        id: 123456789,
        first_name: 'John',
        auth_date: 1700000000,
        hash: '',
      } as TelegramAuthData;

      expect(verifyTelegramAuth(data, botToken)).toBe(false);
    });

    it('should return false for missing bot token', () => {
      const baseData: Omit<TelegramAuthData, 'hash'> = {
        id: 123456789,
        first_name: 'John',
        auth_date: 1700000000,
      };
      const hash = computeTelegramHash(baseData, botToken);
      const data: TelegramAuthData = { ...baseData, hash };

      expect(verifyTelegramAuth(data, '')).toBe(false);
    });
  });

  describe('isTelegramAuthRecent()', () => {
    it('should return true for a recent timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isTelegramAuthRecent(now - 60)).toBe(true); // 1 minute ago
    });

    it('should return true for a timestamp exactly at the boundary', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isTelegramAuthRecent(now - 300)).toBe(true); // exactly 5 minutes (default)
    });

    it('should return false for an old timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isTelegramAuthRecent(now - 301)).toBe(false); // 5 min + 1 sec
    });

    it('should return false for a very old timestamp', () => {
      expect(isTelegramAuthRecent(1000000000)).toBe(false); // Sept 2001
    });

    it('should respect custom maxAgeSeconds', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isTelegramAuthRecent(now - 10, 30)).toBe(true); // 10s ago, 30s max
      expect(isTelegramAuthRecent(now - 31, 30)).toBe(false); // 31s ago, 30s max
    });

    it('should return true for the current timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isTelegramAuthRecent(now)).toBe(true);
    });
  });
});
