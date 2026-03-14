import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let service: TokenService;

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkIn0.signature'),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        NODE_ENV: 'test',
        JWT_REFRESH_EXPIRATION: '7d',
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateAccessToken()', () => {
    it('should return a valid JWT string (3 parts separated by dots)', () => {
      const user = { id: 'test-uuid', email: 'test@example.com', name: 'Test User' };
      const token = service.generateAccessToken(user);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should call jwtService.sign with correct payload', () => {
      const user = { id: 'test-uuid', email: 'test@example.com', name: 'Test User' };
      service.generateAccessToken(user);

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'test-uuid',
        email: 'test@example.com',
        name: 'Test User',
      });
    });
  });

  describe('generateRefreshToken()', () => {
    it('should return a UUID-format string', () => {
      const token = service.generateRefreshToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should return unique tokens on each call', () => {
      const token1 = service.generateRefreshToken();
      const token2 = service.generateRefreshToken();

      expect(token1).not.toBe(token2);
    });
  });

  describe('hashToken()', () => {
    it('should return a hex string of 64 characters (SHA-256)', () => {
      const hash = service.hashToken('test-token');

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return the same hash for the same input', () => {
      const hash1 = service.hashToken('same-token');
      const hash2 = service.hashToken('same-token');

      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = service.hashToken('token-one');
      const hash2 = service.hashToken('token-two');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getRefreshExpirationMs()', () => {
    it('should parse "7d" correctly', () => {
      mockConfigService.get.mockReturnValue('7d');
      const ms = service.getRefreshExpirationMs();

      expect(ms).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should parse "15m" correctly', () => {
      mockConfigService.get.mockReturnValue('15m');
      const ms = service.getRefreshExpirationMs();

      expect(ms).toBe(15 * 60 * 1000);
    });

    it('should parse "3600s" correctly', () => {
      mockConfigService.get.mockReturnValue('3600s');
      const ms = service.getRefreshExpirationMs();

      expect(ms).toBe(3600 * 1000);
    });

    it('should parse "24h" correctly', () => {
      mockConfigService.get.mockReturnValue('24h');
      const ms = service.getRefreshExpirationMs();

      expect(ms).toBe(24 * 60 * 60 * 1000);
    });

    it('should return default 7 days for invalid format', () => {
      mockConfigService.get.mockReturnValue('invalid');
      const ms = service.getRefreshExpirationMs();

      expect(ms).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('getRefreshExpirationDate()', () => {
    it('should return a Date in the future', () => {
      mockConfigService.get.mockReturnValue('7d');
      const now = Date.now();
      const date = service.getRefreshExpirationDate();

      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBeGreaterThan(now);
      // Should be approximately 7 days from now (within 1 second tolerance)
      expect(date.getTime() - now).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 1000);
      expect(date.getTime() - now).toBeLessThan(7 * 24 * 60 * 60 * 1000 + 1000);
    });
  });

  describe('setRefreshTokenCookie()', () => {
    it('should call response.cookie with correct params', () => {
      const mockResponse = {
        cookie: jest.fn(),
      } as any;

      mockConfigService.get.mockImplementation((key: string, defaultValue = '') => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'JWT_REFRESH_EXPIRATION') return '7d';
        return defaultValue;
      });

      service.setRefreshTokenCookie(mockResponse, 'test-refresh-token');

      expect(mockResponse.cookie).toHaveBeenCalledWith('refresh_token', 'test-refresh-token', {
        httpOnly: true,
        secure: false, // NODE_ENV is 'test', not 'production'
        sameSite: 'strict',
        path: '/api/v1/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    });

    it('should set secure=true in production', () => {
      const mockResponse = {
        cookie: jest.fn(),
      } as any;

      mockConfigService.get.mockImplementation((key: string, defaultValue = '') => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'JWT_REFRESH_EXPIRATION') return '7d';
        return defaultValue;
      });

      service.setRefreshTokenCookie(mockResponse, 'test-refresh-token');

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'test-refresh-token',
        expect.objectContaining({
          secure: true,
        }),
      );
    });
  });

  describe('clearRefreshTokenCookie()', () => {
    it('should call response.clearCookie with correct params', () => {
      const mockResponse = {
        clearCookie: jest.fn(),
      } as any;

      mockConfigService.get.mockImplementation((key: string, defaultValue = '') => {
        if (key === 'NODE_ENV') return 'test';
        return defaultValue;
      });

      service.clearRefreshTokenCookie(mockResponse);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refresh_token', {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/api/v1/auth',
      });
    });
  });
});
