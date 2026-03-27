import { verifyTelegramIdToken, TelegramJwtClaims } from './telegram-auth.util';

// Mock jose module
jest.mock('jose', () => {
  const mockJwtVerify = jest.fn();
  return {
    createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
    jwtVerify: mockJwtVerify,
  };
});

// Get reference to the mocked jwtVerify
import { jwtVerify } from 'jose';
const mockJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

describe('telegram-auth.util', () => {
  const botId = '123456789';
  const validIdToken = 'eyJhbGciOiJSUzI1NiJ9.valid.token';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyTelegramIdToken()', () => {
    it('should return claims for a valid id_token', async () => {
      const mockClaims: TelegramJwtClaims = {
        sub: '987654321',
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        photo_url: 'https://t.me/i/userpic/320/photo.jpg',
        iss: 'https://oauth.telegram.org',
        aud: botId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      mockJwtVerify.mockResolvedValue({
        payload: mockClaims,
        protectedHeader: { alg: 'RS256' },
      } as never);

      const result = await verifyTelegramIdToken(validIdToken, botId);

      expect(result).toEqual(mockClaims);
      expect(mockJwtVerify).toHaveBeenCalledWith(validIdToken, 'mock-jwks', {
        issuer: 'https://oauth.telegram.org',
        audience: botId,
      });
    });

    it('should return claims without optional fields', async () => {
      const mockClaims: TelegramJwtClaims = {
        sub: '987654321',
        first_name: 'Jane',
        iss: 'https://oauth.telegram.org',
        aud: botId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      mockJwtVerify.mockResolvedValue({
        payload: mockClaims,
        protectedHeader: { alg: 'RS256' },
      } as never);

      const result = await verifyTelegramIdToken(validIdToken, botId);

      expect(result.sub).toBe('987654321');
      expect(result.first_name).toBe('Jane');
      expect(result.last_name).toBeUndefined();
      expect(result.username).toBeUndefined();
      expect(result.photo_url).toBeUndefined();
    });

    it('should throw when jwtVerify rejects (invalid signature)', async () => {
      mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

      await expect(verifyTelegramIdToken('invalid-token', botId)).rejects.toThrow(
        'signature verification failed',
      );
    });

    it('should throw when jwtVerify rejects (expired token)', async () => {
      mockJwtVerify.mockRejectedValue(new Error('"exp" claim timestamp check failed'));

      await expect(verifyTelegramIdToken(validIdToken, botId)).rejects.toThrow(
        '"exp" claim timestamp check failed',
      );
    });

    it('should throw when jwtVerify rejects (wrong audience)', async () => {
      mockJwtVerify.mockRejectedValue(
        new Error('"aud" claim check failed — unexpected "999999999" value'),
      );

      await expect(verifyTelegramIdToken(validIdToken, botId)).rejects.toThrow('"aud" claim');
    });

    it('should throw when sub claim is missing', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          first_name: 'John',
          iss: 'https://oauth.telegram.org',
          aud: botId,
        },
        protectedHeader: { alg: 'RS256' },
      } as never);

      await expect(verifyTelegramIdToken(validIdToken, botId)).rejects.toThrow('Missing sub claim');
    });

    it('should throw when first_name claim is missing', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          sub: '987654321',
          iss: 'https://oauth.telegram.org',
          aud: botId,
        },
        protectedHeader: { alg: 'RS256' },
      } as never);

      await expect(verifyTelegramIdToken(validIdToken, botId)).rejects.toThrow(
        'Missing first_name claim',
      );
    });

    it('should pass correct issuer and audience to jwtVerify', async () => {
      const customBotId = '555555555';
      const mockClaims: TelegramJwtClaims = {
        sub: '111222333',
        first_name: 'Alice',
        iss: 'https://oauth.telegram.org',
        aud: customBotId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      mockJwtVerify.mockResolvedValue({
        payload: mockClaims,
        protectedHeader: { alg: 'RS256' },
      } as never);

      await verifyTelegramIdToken(validIdToken, customBotId);

      expect(mockJwtVerify).toHaveBeenCalledWith(validIdToken, 'mock-jwks', {
        issuer: 'https://oauth.telegram.org',
        audience: customBotId,
      });
    });
  });
});
