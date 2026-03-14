import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    validateUser: jest.fn(),
    login: jest.fn(),
    refreshTokens: jest.fn(),
    logout: jest.fn(),
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

    it('should throw UnauthorizedException for invalid credentials', async () => {
      mockAuthService.validateUser.mockResolvedValue(null);

      await expect(controller.login(loginDto, mockResponse, mockRequest)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.login(loginDto, mockResponse, mockRequest)).rejects.toThrow(
        'Invalid email or password',
      );
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

    it('should throw UnauthorizedException when no refresh token cookie', async () => {
      const requestWithoutCookie = {
        ...mockRequest,
        cookies: {},
      };

      await expect(controller.refresh(mockResponse, requestWithoutCookie)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.refresh(mockResponse, requestWithoutCookie)).rejects.toThrow(
        'No refresh token provided',
      );
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
});
