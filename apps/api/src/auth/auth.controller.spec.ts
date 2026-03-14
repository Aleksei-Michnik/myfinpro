import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AUTH_ERRORS } from './constants/auth-errors';

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
  };

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as any;

  const mockRequest = {
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'TestAgent/1.0',
    },
    cookies: {},
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);

    jest.clearAllMocks();
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

      expect(mockAuthService.validateUser).toHaveBeenCalledWith(
        loginDto.email,
        loginDto.password,
      );
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
        ...mockRequest,
        cookies: { refresh_token: 'valid-refresh-token' },
      };

      const refreshResult = { accessToken: 'new-access-token' };
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
        ...mockRequest,
        cookies: {},
      };

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
        ...mockRequest,
        cookies: undefined,
      };

      await expect(controller.refresh(mockResponse, requestNoCookies)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout()', () => {
    it('should call AuthService.logout() when refresh token cookie is present', async () => {
      const requestWithCookie = {
        ...mockRequest,
        cookies: { refresh_token: 'some-refresh-token' },
      };

      const logoutResult = { message: 'Logged out successfully' };
      mockAuthService.logout.mockResolvedValue(logoutResult);

      const result = await controller.logout(mockResponse, requestWithCookie);

      expect(mockAuthService.logout).toHaveBeenCalledWith('some-refresh-token', mockResponse);
      expect(result).toEqual(logoutResult);
    });

    it('should call AuthService.logout() with empty string when no cookie', async () => {
      const requestWithoutCookie = {
        ...mockRequest,
        cookies: {},
      };

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
      mockAuthService.getUser.mockRejectedValue(
        new UnauthorizedException('User not found'),
      );

      await expect(controller.getMe(mockJwtPayload)).rejects.toThrow(
        'User not found',
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
  });
});
