import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_ERRORS } from './constants/auth-errors';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
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
    getConnectedAccounts: jest.fn(),
    linkTelegramToUser: jest.fn(),
    unlinkProvider: jest.fn(),
  };

  const mockEmailVerificationService = {
    createAndSendVerification: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
  };

  const mockPasswordResetService = {
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
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
        { provide: EmailVerificationService, useValue: mockEmailVerificationService },
        { provide: PasswordResetService, useValue: mockPasswordResetService },
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

  describe('getConnectedAccounts()', () => {
    const mockJwtPayload = {
      sub: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
    };

    it('should call AuthService.getConnectedAccounts() and return result', async () => {
      const expectedResult = {
        hasPassword: true,
        providers: [
          {
            provider: 'google',
            name: 'Google User',
            email: 'google@example.com',
            avatarUrl: 'https://photo.url',
            connectedAt: new Date(),
          },
        ],
      };

      mockAuthService.getConnectedAccounts.mockResolvedValue(expectedResult);

      const result = await controller.getConnectedAccounts(mockJwtPayload);

      expect(mockAuthService.getConnectedAccounts).toHaveBeenCalledWith('test-uuid');
      expect(result).toEqual(expectedResult);
    });

    it('should return empty providers when user has no OAuth', async () => {
      const expectedResult = {
        hasPassword: true,
        providers: [],
      };

      mockAuthService.getConnectedAccounts.mockResolvedValue(expectedResult);

      const result = await controller.getConnectedAccounts(mockJwtPayload);

      expect(result.providers).toEqual([]);
      expect(result.hasPassword).toBe(true);
    });
  });

  describe('linkTelegram()', () => {
    const mockJwtPayload = {
      sub: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
    };

    const validDto: TelegramAuthDto = {
      id: 123456789,
      first_name: 'John',
      auth_date: Math.floor(Date.now() / 1000),
      hash: 'valid_hash_value',
    };

    it('should verify HMAC and call linkTelegramToUser for valid data', async () => {
      const dto = { ...validDto };
      const expectedResult = {
        hasPassword: true,
        providers: [
          {
            provider: 'telegram',
            name: 'John',
            email: null,
            avatarUrl: null,
            connectedAt: new Date(),
          },
        ],
      };

      mockVerifyTelegramAuth.mockReturnValue({
        telegramId: '123456789',
        firstName: 'John',
      });
      mockAuthService.linkTelegramToUser.mockResolvedValue(expectedResult);

      const result = await controller.linkTelegram(mockJwtPayload, dto);

      expect(mockVerifyTelegramAuth).toHaveBeenCalledWith(dto, TEST_BOT_TOKEN);
      expect(mockAuthService.linkTelegramToUser).toHaveBeenCalledWith('test-uuid', dto);
      expect(result).toEqual(expectedResult);
    });

    it('should throw 401 with TELEGRAM_AUTH_INVALID when HMAC verification fails', async () => {
      const dto = { ...validDto, hash: 'invalid_hash' };

      mockVerifyTelegramAuth.mockImplementation(() => {
        throw new Error('Invalid Telegram auth hash');
      });

      await expect(controller.linkTelegram(mockJwtPayload, dto)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        mockVerifyTelegramAuth.mockImplementation(() => {
          throw new Error('Invalid Telegram auth hash');
        });
        await controller.linkTelegram(mockJwtPayload, dto);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Invalid Telegram authentication data',
            errorCode: AUTH_ERRORS.TELEGRAM_AUTH_INVALID,
          }),
        );
      }

      expect(mockAuthService.linkTelegramToUser).not.toHaveBeenCalled();
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

      await expect(controller.linkTelegram(mockJwtPayload, dto)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        await controller.linkTelegram(mockJwtPayload, dto);
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
  });

  describe('unlinkProvider()', () => {
    const mockJwtPayload = {
      sub: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
    };

    it('should call AuthService.unlinkProvider() and return result', async () => {
      const expectedResult = {
        hasPassword: true,
        providers: [],
      };

      mockAuthService.unlinkProvider.mockResolvedValue(expectedResult);

      const result = await controller.unlinkProvider(mockJwtPayload, 'telegram');

      expect(mockAuthService.unlinkProvider).toHaveBeenCalledWith('test-uuid', 'telegram');
      expect(result).toEqual(expectedResult);
    });

    it('should accept google as a valid provider', async () => {
      const expectedResult = {
        hasPassword: true,
        providers: [],
      };

      mockAuthService.unlinkProvider.mockResolvedValue(expectedResult);

      const result = await controller.unlinkProvider(mockJwtPayload, 'google');

      expect(mockAuthService.unlinkProvider).toHaveBeenCalledWith('test-uuid', 'google');
      expect(result).toEqual(expectedResult);
    });

    it('should throw BadRequestException for invalid provider', async () => {
      await expect(controller.unlinkProvider(mockJwtPayload, 'facebook')).rejects.toThrow(
        BadRequestException,
      );

      try {
        await controller.unlinkProvider(mockJwtPayload, 'facebook');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.PROVIDER_NOT_FOUND,
          }),
        );
      }
    });

    it('should propagate BadRequestException from service (safety check)', async () => {
      const { BadRequestException } = jest.requireActual('@nestjs/common');
      mockAuthService.unlinkProvider.mockRejectedValue(
        new BadRequestException({
          message: 'Cannot unlink the last authentication method',
          errorCode: 'CANNOT_UNLINK_LAST_AUTH',
        }),
      );

      await expect(controller.unlinkProvider(mockJwtPayload, 'telegram')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Rate limiting metadata (new endpoints)', () => {
    it('should have @Throttle metadata on linkTelegram endpoint with limit 5 and ttl 60000', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.linkTelegram);
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.linkTelegram);

      expect(limit).toBe(5);
      expect(ttl).toBe(60000);
    });

    it('should NOT have @Throttle metadata on getConnectedAccounts endpoint (uses global default)', () => {
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        AuthController.prototype.getConnectedAccounts,
      );

      expect(limit).toBeUndefined();
    });

    it('should NOT have @Throttle metadata on unlinkProvider endpoint (uses global default)', () => {
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        AuthController.prototype.unlinkProvider,
      );

      expect(limit).toBeUndefined();
    });

    it('should have @Throttle metadata on sendVerificationEmail with limit 3 and ttl 600000', () => {
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        AuthController.prototype.sendVerificationEmail,
      );
      const ttl = Reflect.getMetadata(
        THROTTLER_TTL_KEY,
        AuthController.prototype.sendVerificationEmail,
      );

      expect(limit).toBe(3);
      expect(ttl).toBe(600000);
    });

    it('should have @Throttle metadata on verifyEmail with limit 5 and ttl 600000', () => {
      const limit = Reflect.getMetadata(THROTTLER_LIMIT_KEY, AuthController.prototype.verifyEmail);
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.verifyEmail);

      expect(limit).toBe(5);
      expect(ttl).toBe(600000);
    });
  });

  describe('sendVerificationEmail()', () => {
    const mockJwtPayload = {
      sub: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
    };

    it('should call resendVerification and return success message', async () => {
      mockEmailVerificationService.resendVerification.mockResolvedValue(undefined);

      const result = await controller.sendVerificationEmail(mockJwtPayload);

      expect(mockEmailVerificationService.resendVerification).toHaveBeenCalledWith('test-uuid');
      expect(result).toEqual({ message: 'Verification email sent' });
    });

    it('should return "Email already verified" when EMAIL_ALREADY_VERIFIED', async () => {
      const { BadRequestException: ActualBadRequest } = jest.requireActual('@nestjs/common');
      mockEmailVerificationService.resendVerification.mockRejectedValue(
        new ActualBadRequest({
          message: 'Email is already verified',
          errorCode: AUTH_ERRORS.EMAIL_ALREADY_VERIFIED,
        }),
      );

      const result = await controller.sendVerificationEmail(mockJwtPayload);

      expect(result).toEqual({ message: 'Email already verified' });
    });

    it('should propagate other errors', async () => {
      const { UnauthorizedException: ActualUnauth } = jest.requireActual('@nestjs/common');
      mockEmailVerificationService.resendVerification.mockRejectedValue(
        new ActualUnauth({
          message: 'User not found',
          errorCode: AUTH_ERRORS.USER_NOT_FOUND,
        }),
      );

      await expect(controller.sendVerificationEmail(mockJwtPayload)).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('verifyEmail()', () => {
    it('should call verifyEmail and return success message', async () => {
      mockEmailVerificationService.verifyEmail.mockResolvedValue({ userId: 'user-1' });

      const result = await controller.verifyEmail('valid-token');

      expect(mockEmailVerificationService.verifyEmail).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual({ message: 'Email verified successfully' });
    });

    it('should throw BadRequestException when token is empty', async () => {
      await expect(controller.verifyEmail('')).rejects.toThrow(BadRequestException);

      try {
        await controller.verifyEmail('');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_INVALID,
          }),
        );
      }
    });

    it('should propagate errors from EmailVerificationService', async () => {
      const { UnauthorizedException: ActualUnauth } = jest.requireActual('@nestjs/common');
      mockEmailVerificationService.verifyEmail.mockRejectedValue(
        new ActualUnauth({
          message: 'Invalid verification token',
          errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_INVALID,
        }),
      );

      await expect(controller.verifyEmail('bad-token')).rejects.toThrow(
        'Invalid verification token',
      );
    });
  });

  describe('forgotPassword()', () => {
    it('should call passwordResetService.forgotPassword and return generic message', async () => {
      mockPasswordResetService.forgotPassword.mockResolvedValue(undefined);

      const result = await controller.forgotPassword({ email: 'test@example.com' });

      expect(mockPasswordResetService.forgotPassword).toHaveBeenCalledWith('test@example.com');
      expect(result).toEqual({
        message: 'If an account with this email exists, a reset link has been sent.',
      });
    });

    it('should return same generic message even for non-existent email (prevent enumeration)', async () => {
      mockPasswordResetService.forgotPassword.mockResolvedValue(undefined);

      const result = await controller.forgotPassword({ email: 'nonexistent@example.com' });

      expect(result).toEqual({
        message: 'If an account with this email exists, a reset link has been sent.',
      });
    });

    it('should have @Throttle metadata with limit 3 and ttl 600000', () => {
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        AuthController.prototype.forgotPassword,
      );
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.forgotPassword);

      expect(limit).toBe(3);
      expect(ttl).toBe(600000);
    });
  });

  describe('resetPassword()', () => {
    it('should call passwordResetService.resetPassword and return success message', async () => {
      mockPasswordResetService.resetPassword.mockResolvedValue({ userId: 'user-1' });

      const result = await controller.resetPassword({
        token: 'valid-token',
        password: 'NewSecurePass123',
      });

      expect(mockPasswordResetService.resetPassword).toHaveBeenCalledWith(
        'valid-token',
        'NewSecurePass123',
      );
      expect(result).toEqual({
        message: 'Password reset successfully. Please sign in with your new password.',
      });
    });

    it('should propagate UnauthorizedException from service (invalid token)', async () => {
      const { UnauthorizedException: ActualUnauth } = jest.requireActual('@nestjs/common');
      mockPasswordResetService.resetPassword.mockRejectedValue(
        new ActualUnauth({
          message: 'Invalid password reset token',
          errorCode: AUTH_ERRORS.RESET_TOKEN_INVALID,
        }),
      );

      await expect(
        controller.resetPassword({ token: 'bad-token', password: 'NewSecurePass123' }),
      ).rejects.toThrow('Invalid password reset token');
    });

    it('should propagate BadRequestException from service (used token)', async () => {
      const { BadRequestException: ActualBadRequest } = jest.requireActual('@nestjs/common');
      mockPasswordResetService.resetPassword.mockRejectedValue(
        new ActualBadRequest({
          message: 'Password reset token has already been used',
          errorCode: AUTH_ERRORS.RESET_TOKEN_USED,
        }),
      );

      await expect(
        controller.resetPassword({ token: 'used-token', password: 'NewSecurePass123' }),
      ).rejects.toThrow('Password reset token has already been used');
    });

    it('should have @Throttle metadata with limit 5 and ttl 600000', () => {
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        AuthController.prototype.resetPassword,
      );
      const ttl = Reflect.getMetadata(THROTTLER_TTL_KEY, AuthController.prototype.resetPassword);

      expect(limit).toBe(5);
      expect(ttl).toBe(600000);
    });
  });
});
