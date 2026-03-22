import { ConfigService } from '@nestjs/config';
import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost/api/v1/auth/google/callback',
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new GoogleStrategy(mockConfigService as unknown as ConfigService);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate()', () => {
    it('should return the Google profile data', async () => {
      const profile = {
        id: 'google-123456',
        displayName: 'Test User',
        emails: [{ value: 'test@gmail.com', verified: true }],
        photos: [{ value: 'https://lh3.googleusercontent.com/photo.jpg' }],
      };

      const done = jest.fn();

      await strategy.validate('access-token', 'refresh-token', profile, done);

      expect(done).toHaveBeenCalledWith(null, {
        googleId: 'google-123456',
        email: 'test@gmail.com',
        name: 'Test User',
        picture: 'https://lh3.googleusercontent.com/photo.jpg',
        emailVerified: true,
      });
    });

    it('should handle profile without email', async () => {
      const profile = {
        id: 'google-789',
        displayName: 'No Email User',
        emails: undefined,
        photos: undefined,
      };

      const done = jest.fn();

      await strategy.validate('access-token', 'refresh-token', profile, done);

      expect(done).toHaveBeenCalledWith(null, {
        googleId: 'google-789',
        email: undefined,
        name: 'No Email User',
        picture: undefined,
        emailVerified: false,
      });
    });

    it('should handle unverified email', async () => {
      const profile = {
        id: 'google-unverified',
        displayName: 'Unverified User',
        emails: [{ value: 'unverified@gmail.com', verified: false }],
        photos: [],
      };

      const done = jest.fn();

      await strategy.validate('access-token', 'refresh-token', profile, done);

      expect(done).toHaveBeenCalledWith(null, {
        googleId: 'google-unverified',
        email: 'unverified@gmail.com',
        name: 'Unverified User',
        picture: undefined,
        emailVerified: false,
      });
    });
  });

  describe('constructor', () => {
    it('should use dummy values when GOOGLE_CLIENT_ID is not set', () => {
      const configWithoutGoogle = {
        get: jest.fn((key: string, defaultValue?: string) => {
          if (key === 'GOOGLE_CLIENT_ID') return undefined;
          if (key === 'GOOGLE_CLIENT_SECRET') return undefined;
          return defaultValue;
        }),
      };

      // Should NOT throw — graceful degradation
      expect(() => {
        new GoogleStrategy(configWithoutGoogle as unknown as ConfigService);
      }).not.toThrow();
    });
  });
});
