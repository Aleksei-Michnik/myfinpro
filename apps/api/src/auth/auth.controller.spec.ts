import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_ERRORS } from './constants/auth-errors';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
jest.mock('./utils/telegram-auth.util', () => ({
  verifyTelegramAuth: jest.fn(),
}));
import { verifyTelegramAuth } from './utils/telegram-auth.util';
const mockVerifyTelegramAuth = verifyTelegramAuth as jest.MockedFunction<typeof verifyTelegramAuth>;

// Internal metadata keys used by @nestjs/throttler's @Throttle() decorator
// The decorator concatenates the base key with the throttler name (e.g., 'default')
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_KEY = 'THROTTLER:TTLdefault';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    validateUser: jest.fn(),
    login: jest.fn(),
    refreshTokens: jest.fn(),
    logout: jest.fn(),
    getUser: jest.fn(),
    findOrCreateGoogleUser: jest.fn(),
    findOrCreateTelegramUser: jest.fn(),
  };

  const TEST_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        FRONTEND_URL: 'http://localhost:3000',
        TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

  const mockRequestData = {
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'TestAgent/1.0',
    },
    cookies: {} as Record<string, string>,
  };
  const mockRequest = mockRequestData as unknown as Request;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);

    jest.clearAllMocks();

    // Restore default config mock (tests that override this must do so per-test)
    mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        FRONTEND_URL: 'http://localhost:3000',
        TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      };
      return config[key] ?? defaultValue;
    });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register()', () => {
    it('should call AuthService.register() with DTO, response, ip and userAgent', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'SecurePass123',
        name: 'Test User',
      };

      const expectedResult = {
        user: {
          id: 'test-uuid',
          email: 'test@example.com',
          name: 'Test User',
          defaultCurrency: 'USD',
          locale: 'en',
        },
        accessToken: 'mock-jwt-token',
      };

      mockAuthService.register.mockResolvedValue(expectedResult);

      const result = await controller.register(registerDto, mockResponse, mockRequest);

      expect(mockAuthService.register).toHaveBeenCalledWith(
        registerDto,
        mockResponse,
        '127.0.0.1',
        'TestAgent/1.0',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should return the result from AuthService', async () => {
      const registerDto: RegisterDto = {
        email: 'another@example.com',
        password: 'AnotherPass456',
        name: 'Another User',
        defaultCurrency: 'EUR',
        locale: 'he',
      };

      const expectedResult = {
        user: {
          id: 'another-uuid',
          email: 'another@example.com',
          name: 'Another User',
          defaultCurrency: 'EUR',
          locale: 'he',
        },
        accessToken: 'mock-jwt-token',
      };

      mockAuthService.register.mockResolvedValue(expectedResult);

      const result = await controller.register(registerDto, mockResponse, mockRequest);

      expect(result).toEqual(expectedResult);
      expect(result.user.email).toBe('another@example.com');
    });
  });

  describe('login()', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'SecurePass123',
    };

    const mockUser = {
      id: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
    };

    it('should call validateUser and login with response, ip and userAgent', async () => {
      const loginResponse = {
        user: mockUser,
        accessToken: 'mock-jwt-token',
      };

      mockAuthService.validateUser.mockResolvedValue(mockUser);
      mockAuthService.login.mockResolvedValue(loginResponse);

      const result = await controller.login(loginDto, mockResponse, mockRequest);

      expect(mockAuthService.validateUser).toHaveBeenCalledWith(loginDto.email, loginDto.password);
      expect(mockAuthService.login).toHaveBeenCalledWith(
        mockUser,
        mockResponse,
        '127.0.0.1',
        'TestAgent/1.0',
      );
      expect(result).toEqual(loginResponse);
    });

    it('should throw UnauthorizedException with INVALID_CREDENTIALS errorCode for invalid credentials', async () => {
      mockAuthService.validateUser.mockResolvedValue(null);

      await expect(controller.login(loginDto, mockResponse, mockRequest)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        mockAuthService.validateUser.mockResolvedValue(null);
        await controller.login(loginDto, mockResponse, mockRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Invalid email or password',
            errorCode: AUTH_ERRORS.INVALID_CREDENTIALS,
          }),
        );
      }

      expect(mockAuthService.login).not.toHaveBeenCalled();
    });
  });

  describe('refresh()', () => {
    it('should call AuthService.refreshTokens() when cookie is present', async () => {
      const requestWithCookie = {
        ...mockRequestData,
        cookies: { refresh_token: 'valid-refresh-token' },
      } as unknown as Request;

      const refreshResult = {
        user: {
          id: 'test-uuid',
          email: 'test@example.com',
          name: 'Test User',
          defaultCurrency: 'USD',
          locale: 'en',
        },
        accessToken: 'new-access-token',
      };
      mockAuthService.refreshTokens.mockResolvedValue(refreshResult);

      const result = await controller.refresh(mockResponse, requestWithCookie);

      expect(mockAuthService.refreshTokens).toHaveBeenCalledWith(
        'valid-refresh-token',
        mockResponse,
        '127.0.0.1',
        'TestAgent/1.0',
      );
      expect(result).toEqual(refreshResult);
    });

    it('should throw UnauthorizedException with REFRESH_FAILED errorCode when no refresh token cookie', async () => {
      const requestWithoutCookie = {
        ...mockRequestData,
        cookies: {},
      } as unknown as Request;

      await expect(controller.refresh(mockResponse, requestWithoutCookie)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        await controller.refresh(mockResponse, requestWithoutCookie);
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'No refresh token provided',
            errorCode: AUTH_ERRORS.REFRESH_FAILED,
          }),
        );
      }

      expect(mockAuthService.refreshTokens).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when cookies is undefined', async () => {
      const requestNoCookies = {
        ...mockRequestData,
        cookies: undefined,
      } as unknown as Request;

      await expect(controller.refresh(mockResponse, requestNoCookies)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout()', () => {
    it('should call AuthService.logout() when refresh token cookie is present', async () => {
      const requestWithCookie = {
        ...mockRequestData,
        cookies: { refresh_token: 'some-refresh-token' },
      } as unknown as Request;

      const logoutResult = { message: 'Logged out successfully' };
      mockAuthService.logout.mockResolvedValue(logoutResult);

      const result = await controller.logout(mockResponse, requestWithCookie);

      expect(mockAuthService.logout).toHaveBeenCalledWith('some-refresh-token', mockResponse);
      expect(result).toEqual(logoutResult);
    });

    it('should call AuthService.logout() with empty string when no cookie', async () => {
      const requestWithoutCookie = {
        ...mockRequestData,
        cookies: {},
      } as unknown as Request;

      const logoutResult = { message: 'Logged out successfully' };
      mockAuthService.logout.mockResolvedValue(logoutResult);

      const result = await controller.logout(mockResponse, requestWithoutCookie);

      expect(mockAuthService.logout).toHaveBeenCalledWith('', mockResponse);
      expect(result).toEqual(logoutResult);
    });
  });

  describe('getMe()', () => {
    const mockJwtPayload = {
      sub: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
    };

    const mockUserData = {
      id: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
      timezone: 'UTC',
    };

    it('should call AuthService.getUser() with user sub from JWT payload', async () => {
      mockAuthService.getUser.mockResolvedValue(mockUserData);

      const result = await controller.getMe(mockJwtPayload);

      expect(mockAuthService.getUser).toHaveBeenCalledWith('test-uuid');
      expect(result).toEqual(mockUserData);
    });

    it('should return user data from AuthService', async () => {
      mockAuthService.getUser.mockResolvedValue(mockUserData);

      const result = await controller.getMe(mockJwtPayload);

      expect(result.id).toBe('test-uuid');
      expect(result.email).toBe('test@example.com');
      expect(result.name).toBe('Test User');
      expect(result.defaultCurrency).toBe('USD');
      expect(result.locale).toBe('en');
      expect(result.timezone).toBe('UTC');
    });

    it('should propagate UnauthorizedException from AuthService', async () => {
      const { UnauthorizedException } = jest.requireActual('@nestjs/common');
      mockAuthService.getUser.mockRejectedValue(new UnauthorizedException('User not found'));

      await expect(controller.getMe(mockJwtPayload)).rejects.toThrow('User not found');
    });
  });

  describe('googleAuth()', () => {
    it('should be defined', () => {
      expect(controller.googleAuth).toBeDefined();
    });
  });

  describe('googleCallback()', () => {
    it('should call findOrCreateGoogleUser and redirect to frontend', async () => {
      const mockUser = {
        id: 'google-user-uuid',
        email: 'google@example.com',
        name: 'Google User',
        defaultCurrency: 'USD',
        locale: 'en',
        timezone: 'UTC',
        isActive: true,
        emailVerified: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const googleProfile = {
        googleId: 'google-123',
        email: 'google@example.com',
        name: 'Google User',
        picture: 'https://lh3.googleusercontent.com/photo.jpg',
        emailVerified: true,
      };

      const requestWithUser = {
        ...mockRequestData,
        user: googleProfile,
      } as unknown as Request;

      const redirectResponse = {
        ...mockResponse,
        redirect: jest.fn(),
      } as unknown as Response;

      mockAuthService.findOrCreateGoogleUser.mockResolvedValue(mockUser);
      mockAuthService.login.mockResolvedValue({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
          defaultCurrency: mockUser.defaultCurrency,
          locale: mockUser.locale,
        },
        accessToken: 'mock-jwt-token',
      });

      await controller.googleCallback(requestWithUser, redirectResponse);

      expect(mockAuthService.findOrCreateGoogleUser).toHaveBeenCalledWith(googleProfile);
      expect(mockAuthService.login).toHaveBeenCalledWith(
        mockUser,
        redirectResponse,
        '127.0.0.1',
        'TestAgent/1.0',
      );
      expect(redirectResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/en/auth/callback?token=mock-jwt-token',
      );
    });
  });

  describe('Rate limiting metadata', () => {
    it('should have @Throttle metadata on register endpoint with limit 5 and ttl 60000', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.register);
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.register);

      expect(limit).toBe(5);
      expect(ttl).toBe(60000);
    });

    it('should have @Throttle metadata on login endpoint with limit 5 and ttl 60000', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.login);
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.login);

      expect(limit).toBe(5);
      expect(ttl).toBe(60000);
    });

    it('should have @Throttle metadata on refresh endpoint with limit 10 and ttl 60000', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.refresh);
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.refresh);

      expect(limit).toBe(10);
      expect(ttl).toBe(60000);
    });

    it('should have @Throttle metadata on logout endpoint with limit 10 and ttl 60000', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.logout);
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.logout);

      expect(limit).toBe(10);
      expect(ttl).toBe(60000);
    });

    it('should NOT have @Throttle metadata on getMe endpoint (uses global default)', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.getMe);

      // getMe should not have per-endpoint throttle override
      expect(limit).toBeUndefined();
    });

    it('should have @Throttle metadata on googleAuth endpoint with limit 10 and ttl 60000', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.googleAuth);
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.googleAuth);

      expect(limit).toBe(10);
      expect(ttl).toBe(60000);
    });

    it('should have @Throttle metadata on googleCallback endpoint with limit 10 and ttl 60000', () => {
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        AuthController.prototype.googleCallback,
      );
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.googleCallback);

      expect(limit).toBe(10);
      expect(ttl).toBe(60000);
    });

    it('should have @Throttle metadata on telegramCallback endpoint with limit 5 and ttl 60000', () => {
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        AuthController.prototype.telegramCallback,
      );
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.telegramCallback);

      expect(limit).toBe(5);
      expect(ttl).toBe(60000);
    });
  });

  describe('telegramCallback()', () => {
    const mockUser = {
      id: 'telegram-user-uuid',
      email: 'telegram_123456789@telegram.user',
      name: 'John',
      defaultCurrency: 'USD',
      locale: 'en',
      timezone: 'UTC',
      isActive: true,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const validDto: TelegramAuthDto = {
      id: 123456789,
      first_name: 'John',
      auth_date: Math.floor(Date.now() / 1000),
      hash: 'valid_hash_value',
    };

    it('should return tokens for valid Telegram hash-based auth data', async () => {
      const dto = { ...validDto };
      const loginResponse = {
        user: {
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
          defaultCurrency: mockUser.defaultCurrency,
          locale: mockUser.locale,
        },
        accessToken: 'mock-jwt-token',
      };

      mockVerifyTelegramAuth.mockReturnValue({
        telegramId: '123456789',
        firstName: 'John',
        lastName: undefined,
        username: undefined,
        photoUrl: undefined,
      });

      mockAuthService.findOrCreateTelegramUser.mockResolvedValue(mockUser);
      mockAuthService.login.mockResolvedValue(loginResponse);

      const result = await controller.telegramCallback(dto, mockResponse, mockRequest);

      expect(mockVerifyTelegramAuth).toHaveBeenCalledWith(dto, TEST_BOT_TOKEN);
      expect(mockAuthService.findOrCreateTelegramUser).toHaveBeenCalledWith({
        telegramId: '123456789',
        firstName: 'John',
        lastName: undefined,
        username: undefined,
        photoUrl: undefined,
      });
      expect(mockAuthService.login).toHaveBeenCalledWith(
        mockUser,
        mockResponse,
        '127.0.0.1',
        'TestAgent/1.0',
      );
      expect(result).toEqual(loginResponse);
    });

    it('should pass optional profile fields from verified auth data', async () => {
      const dto: TelegramAuthDto = {
        ...validDto,
        last_name: 'Doe',
        username: 'johndoe',
        photo_url: 'https://t.me/i/userpic/320/photo.jpg',
      };

      mockVerifyTelegramAuth.mockReturnValue({
        telegramId: '123456789',
        firstName: 'John',
        lastName: 'Doe',
        username: 'johndoe',
        photoUrl: 'https://t.me/i/userpic/320/photo.jpg',
      });

      mockAuthService.findOrCreateTelegramUser.mockResolvedValue(mockUser);
      mockAuthService.login.mockResolvedValue({
        user: { id: mockUser.id },
        accessToken: 'token',
      });

      await controller.telegramCallback(dto, mockResponse, mockRequest);

      expect(mockAuthService.findOrCreateTelegramUser).toHaveBeenCalledWith({
        telegramId: '123456789',
        firstName: 'John',
        lastName: 'Doe',
        username: 'johndoe',
        photoUrl: 'https://t.me/i/userpic/320/photo.jpg',
      });
    });

    it('should throw 401 with TELEGRAM_AUTH_INVALID when hash verification fails', async () => {
      const dto = { ...validDto, hash: 'invalid_hash' };

      mockVerifyTelegramAuth.mockImplementation(() => {
        throw new Error('Invalid Telegram auth hash');
      });

      await expect(controller.telegramCallback(dto, mockResponse, mockRequest)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        mockVerifyTelegramAuth.mockImplementation(() => {
          throw new Error('Invalid Telegram auth hash');
        });
        await controller.telegramCallback(dto, mockResponse, mockRequest);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Invalid Telegram authentication data',
            errorCode: AUTH_ERRORS.TELEGRAM_AUTH_INVALID,
          }),
        );
      }
    });

    it('should throw 401 with TELEGRAM_AUTH_INVALID when auth data is stale', async () => {
      const dto = { ...validDto, auth_date: Math.floor(Date.now() / 1000) - 86401 };

      mockVerifyTelegramAuth.mockImplementation(() => {
        throw new Error('Telegram auth data is too old');
      });

      await expect(controller.telegramCallback(dto, mockResponse, mockRequest)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        mockVerifyTelegramAuth.mockImplementation(() => {
          throw new Error('Telegram auth data is too old');
        });
        await controller.telegramCallback(dto, mockResponse, mockRequest);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Invalid Telegram authentication data',
            errorCode: AUTH_ERRORS.TELEGRAM_AUTH_INVALID,
          }),
        );
      }
    });

    it('should throw 401 with OAUTH_PROVIDER_ERROR when bot token is not configured', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') return defaultValue as string;
        const config: Record<string, string> = {
          FRONTEND_URL: 'http://localhost:3000',
        };
        return config[key] ?? (defaultValue as string);
      });

      const dto = { ...validDto };

      await expect(controller.telegramCallback(dto, mockResponse, mockRequest)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        await controller.telegramCallback(dto, mockResponse, mockRequest);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Telegram authentication is not configured',
            errorCode: AUTH_ERRORS.OAUTH_PROVIDER_ERROR,
          }),
        );
      }
    });

    it('should pass full bot token (not just bot ID) to verifyTelegramAuth', async () => {
      const dto = { ...validDto };

      mockVerifyTelegramAuth.mockReturnValue({
        telegramId: '999',
        firstName: 'Test',
      });

      mockAuthService.findOrCreateTelegramUser.mockResolvedValue(mockUser);
      mockAuthService.login.mockResolvedValue({
        user: { id: mockUser.id },
        accessToken: 'token',
      });

      await controller.telegramCallback(dto, mockResponse, mockRequest);

      // Should pass the full bot token, not just the bot ID
      expect(mockVerifyTelegramAuth).toHaveBeenCalledWith(dto, TEST_BOT_TOKEN);
    });
  });
});
