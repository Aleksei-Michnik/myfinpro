import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AUTH_ERRORS } from './constants/auth-errors';
import { RegisterDto } from './dto/register.dto';
import { ValidatedUser } from './interfaces/validated-user.interface';
import { EmailVerificationService } from './services/email-verification.service';
import { OAuthService } from './services/oauth.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { TokenService } from './services/token.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
    },
    oAuthProvider: {
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockOAuthService = {
    findByProvider: jest.fn(),
    findByProviderEmail: jest.fn(),
    createOAuthProvider: jest.fn(),
    linkToUser: jest.fn(),
  };

  const mockPasswordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  };

  const mockTokenService = {
    generateAccessToken: jest.fn().mockReturnValue('mock-jwt-access-token'),
    generateRefreshToken: jest.fn().mockReturnValue('mock-refresh-token-uuid'),
    hashToken: jest.fn().mockReturnValue('mock-hashed-token'),
    setRefreshTokenCookie: jest.fn(),
    clearRefreshTokenCookie: jest.fn(),
    getRefreshExpirationDate: jest.fn().mockReturnValue(new Date('2026-03-21T00:00:00Z')),
    getRefreshExpirationMs: jest.fn().mockReturnValue(7 * 24 * 60 * 60 * 1000),
  };

  const mockRefreshTokenService = {
    rotateRefreshToken: jest.fn(),
    revokeToken: jest.fn(),
    revokeAllUserTokens: jest.fn(),
    cleanupExpiredTokens: jest.fn(),
  };

  const mockEmailVerificationService = {
    createAndSendVerification: jest.fn().mockResolvedValue(undefined),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
  };

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
        { provide: OAuthService, useValue: mockOAuthService },
        { provide: EmailVerificationService, useValue: mockEmailVerificationService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register()', () => {
    const registerDto: RegisterDto = {
      email: 'test@example.com',
      password: 'SecurePass123',
      name: 'Test User',
    };

    const mockUser = {
      id: 'test-uuid-1234',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
      passwordHash: '$argon2id$hashed',
      isActive: true,
      emailVerified: false,
      timezone: 'UTC',
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should successfully register a new user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.register(registerDto, mockResponse);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.name).toBe('Test User');
      expect(result.user.defaultCurrency).toBe('USD');
      expect(result.user.locale).toBe('en');
      expect(result.accessToken).toBe('mock-jwt-access-token');
      // Must NOT expose passwordHash
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('should generate real JWT access token', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.register(registerDto, mockResponse);

      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith(mockUser);
    });

    it('should store hashed refresh token in DB', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.register(registerDto, mockResponse, '127.0.0.1', 'TestAgent');

      expect(mockTokenService.generateRefreshToken).toHaveBeenCalled();
      expect(mockTokenService.hashToken).toHaveBeenCalledWith('mock-refresh-token-uuid');
      expect(mockPrismaService.refreshToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: 'mock-hashed-token',
          userId: mockUser.id,
          expiresAt: expect.any(Date),
          ipAddress: '127.0.0.1',
          userAgent: 'TestAgent',
        },
      });
    });

    it('should set refresh token cookie', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.register(registerDto, mockResponse);

      expect(mockTokenService.setRefreshTokenCookie).toHaveBeenCalledWith(
        mockResponse,
        'mock-refresh-token-uuid',
      );
    });

    it('should throw ConflictException with errorCode if email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(registerDto, mockResponse)).rejects.toThrow(ConflictException);

      try {
        await service.register(registerDto, mockResponse);
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        const response = (error as ConflictException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'An account with this email already exists',
            errorCode: AUTH_ERRORS.EMAIL_ALREADY_EXISTS,
          }),
        );
      }
    });

    it('should call PasswordService.hash() with the password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.register(registerDto, mockResponse);

      expect(mockPasswordService.hash).toHaveBeenCalledWith('SecurePass123');
    });

    it('should create an audit log entry', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.register(registerDto, mockResponse);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          action: 'USER_REGISTERED',
          entity: 'User',
          entityId: mockUser.id,
          details: { email: mockUser.email },
        },
      });
    });

    it('should use default currency and locale when not provided', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.register(registerDto, mockResponse);

      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: '$argon2id$hashed',
          name: 'Test User',
          defaultCurrency: 'USD',
          locale: 'en',
        },
      });
    });

    it('should use provided currency and locale', async () => {
      const dtoWithOptions: RegisterDto = {
        ...registerDto,
        defaultCurrency: 'EUR',
        locale: 'he',
      };
      const userWithOptions = {
        ...mockUser,
        defaultCurrency: 'EUR',
        locale: 'he',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(userWithOptions);
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.register(dtoWithOptions, mockResponse);

      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: '$argon2id$hashed',
          name: 'Test User',
          defaultCurrency: 'EUR',
          locale: 'he',
        },
      });
      expect(result.user.defaultCurrency).toBe('EUR');
      expect(result.user.locale).toBe('he');
    });
  });

  describe('validateUser()', () => {
    const mockUser = {
      id: 'test-uuid-1234',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
      passwordHash: '$argon2id$hashed',
      isActive: true,
      emailVerified: false,
      timezone: 'UTC',
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return user (without passwordHash) for valid credentials', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'SecurePass123');

      expect(result).toBeDefined();
      expect(result!.id).toBe('test-uuid-1234');
      expect(result!.email).toBe('test@example.com');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should return null for non-existent email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('nonexistent@example.com', 'SomePass123');

      expect(result).toBeNull();
    });

    it('should return null for wrong password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'WrongPass123');

      expect(result).toBeNull();
    });

    it('should return null for inactive user', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      mockPrismaService.user.findUnique.mockResolvedValue(inactiveUser);

      const result = await service.validateUser('test@example.com', 'SecurePass123');

      expect(result).toBeNull();
      // Should not even attempt password verification
      expect(mockPasswordService.verify).not.toHaveBeenCalled();
    });

    it('should return null for user without password hash (OAuth-only)', async () => {
      const oauthUser = { ...mockUser, passwordHash: null };
      mockPrismaService.user.findUnique.mockResolvedValue(oauthUser);

      const result = await service.validateUser('test@example.com', 'SomePass123');

      expect(result).toBeNull();
      expect(mockPasswordService.verify).not.toHaveBeenCalled();
    });

    it('should log failed login attempt on wrong password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(false);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.validateUser('test@example.com', 'WrongPass123');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          action: 'LOGIN_FAILED',
          entity: 'User',
          entityId: mockUser.id,
          details: { reason: 'invalid_password' },
        },
      });
    });

    it('should normalize email to lowercase and trimmed', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await service.validateUser('  Test@Example.COM  ', 'SomePass123');

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });
  });

  describe('login()', () => {
    const mockUser: ValidatedUser = {
      id: 'test-uuid-1234',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
      timezone: 'UTC',
      isActive: true,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    it('should update lastLoginAt', async () => {
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.login(mockUser, mockResponse);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('should create audit log for login', async () => {
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.login(mockUser, mockResponse);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          action: 'USER_LOGIN',
          entity: 'User',
          entityId: mockUser.id,
        },
      });
    });

    it('should return user data and JWT accessToken', async () => {
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.login(mockUser, mockResponse);

      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        defaultCurrency: mockUser.defaultCurrency,
        locale: mockUser.locale,
        emailVerified: mockUser.emailVerified,
      });
      expect(result.accessToken).toBe('mock-jwt-access-token');
    });

    it('should generate access token via TokenService', async () => {
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.login(mockUser, mockResponse);

      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith(mockUser);
    });

    it('should store hashed refresh token in DB', async () => {
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.login(mockUser, mockResponse, '192.168.1.1', 'Mozilla/5.0');

      expect(mockTokenService.generateRefreshToken).toHaveBeenCalled();
      expect(mockTokenService.hashToken).toHaveBeenCalledWith('mock-refresh-token-uuid');
      expect(mockPrismaService.refreshToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: 'mock-hashed-token',
          userId: mockUser.id,
          expiresAt: expect.any(Date),
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      });
    });

    it('should set refresh token cookie', async () => {
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      await service.login(mockUser, mockResponse);

      expect(mockTokenService.setRefreshTokenCookie).toHaveBeenCalledWith(
        mockResponse,
        'mock-refresh-token-uuid',
      );
    });

    it('should not expose passwordHash in response', async () => {
      const userWithHash = { ...mockUser, passwordHash: '$argon2id$secret' };
      mockPrismaService.user.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.refreshToken.create.mockResolvedValue({});

      const result = await service.login(userWithHash, mockResponse);

      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('refreshTokens()', () => {
    const mockUser = {
      id: 'test-uuid-1234',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
      isActive: true,
    };

    it('should rotate token and return new access token with user data', async () => {
      mockRefreshTokenService.rotateRefreshToken.mockResolvedValue({
        userId: mockUser.id,
        newRefreshToken: 'new-refresh-token',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.refreshTokens(
        'old-refresh-token',
        mockResponse,
        '127.0.0.1',
        'TestAgent',
      );

      expect(mockRefreshTokenService.rotateRefreshToken).toHaveBeenCalledWith(
        'old-refresh-token',
        '127.0.0.1',
        'TestAgent',
      );
      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith(mockUser);
      expect(mockTokenService.setRefreshTokenCookie).toHaveBeenCalledWith(
        mockResponse,
        'new-refresh-token',
      );
      expect(result.accessToken).toBe('mock-jwt-access-token');
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        defaultCurrency: mockUser.defaultCurrency,
        locale: mockUser.locale,
        emailVerified: undefined,
      });
    });

    it('should throw UnauthorizedException with REFRESH_FAILED errorCode if user not found', async () => {
      mockRefreshTokenService.rotateRefreshToken.mockResolvedValue({
        userId: 'non-existent-user',
        newRefreshToken: 'new-refresh-token',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      try {
        await service.refreshTokens('old-refresh-token', mockResponse);
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.REFRESH_FAILED,
          }),
        );
      }
    });

    it('should throw UnauthorizedException with REFRESH_FAILED errorCode if user is inactive', async () => {
      mockRefreshTokenService.rotateRefreshToken.mockResolvedValue({
        userId: mockUser.id,
        newRefreshToken: 'new-refresh-token',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      try {
        await service.refreshTokens('old-refresh-token', mockResponse);
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.REFRESH_FAILED,
          }),
        );
      }
    });

    it('should propagate UnauthorizedException from rotateRefreshToken (reuse detection)', async () => {
      mockRefreshTokenService.rotateRefreshToken.mockRejectedValue(
        new UnauthorizedException('Token reuse detected. All sessions revoked.'),
      );

      await expect(service.refreshTokens('reused-token', mockResponse)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getUser()', () => {
    const mockUser = {
      id: 'test-uuid-1234',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
      timezone: 'UTC',
    };

    it('should return user data when user exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUser('test-uuid-1234');

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-uuid-1234' },
        select: {
          id: true,
          email: true,
          name: true,
          defaultCurrency: true,
          locale: true,
          timezone: true,
          emailVerified: true,
        },
      });
    });

    it('should throw UnauthorizedException with USER_NOT_FOUND errorCode when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getUser('non-existent-id')).rejects.toThrow(UnauthorizedException);

      try {
        await service.getUser('non-existent-id');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'User not found',
            errorCode: AUTH_ERRORS.USER_NOT_FOUND,
          }),
        );
      }
    });

    it('should not expose passwordHash in returned data', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUser('test-uuid-1234');

      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  describe('logout()', () => {
    it('should revoke token, clear cookie, and log audit event', async () => {
      mockRefreshTokenService.revokeToken.mockResolvedValue(undefined);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.logout('some-refresh-token', mockResponse, 'user-uuid');

      expect(mockTokenService.hashToken).toHaveBeenCalledWith('some-refresh-token');
      expect(mockRefreshTokenService.revokeToken).toHaveBeenCalledWith('mock-hashed-token');
      expect(mockTokenService.clearRefreshTokenCookie).toHaveBeenCalledWith(mockResponse);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid',
          action: 'USER_LOGOUT',
          entity: 'User',
          entityId: 'user-uuid',
        },
      });
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('should handle logout without userId', async () => {
      mockRefreshTokenService.revokeToken.mockResolvedValue(undefined);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.logout('some-refresh-token', mockResponse);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: null,
          action: 'USER_LOGOUT',
          entity: 'User',
          entityId: null,
        },
      });
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  describe('findOrCreateGoogleUser()', () => {
    const mockGoogleProfile = {
      googleId: 'google-123',
      email: 'google@example.com',
      name: 'Google User',
      picture: 'https://lh3.googleusercontent.com/pic.jpg',
      emailVerified: true,
    };

    const mockUser = {
      id: 'user-uuid',
      email: 'google@example.com',
      name: 'Google User',
      passwordHash: null,
      defaultCurrency: 'USD',
      locale: 'en',
      timezone: 'UTC',
      isActive: true,
      emailVerified: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return existing user when OAuth provider is found', async () => {
      mockOAuthService.findByProvider.mockResolvedValue({
        id: 'oauth-uuid',
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findOrCreateGoogleUser(mockGoogleProfile);

      expect(result.id).toBe('user-uuid');
      expect(result.email).toBe('google@example.com');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should throw if OAuth provider found but user is inactive', async () => {
      mockOAuthService.findByProvider.mockResolvedValue({
        id: 'oauth-uuid',
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(service.findOrCreateGoogleUser(mockGoogleProfile)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should link Google to existing user by email', async () => {
      mockOAuthService.findByProvider.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockOAuthService.linkToUser.mockResolvedValue({});

      const result = await service.findOrCreateGoogleUser(mockGoogleProfile);

      expect(mockOAuthService.linkToUser).toHaveBeenCalledWith(
        'google',
        'google-123',
        'user-uuid',
        {
          email: 'google@example.com',
          name: 'Google User',
          avatarUrl: 'https://lh3.googleusercontent.com/pic.jpg',
        },
      );
      expect(result.id).toBe('user-uuid');
    });

    it('should create a new user when no existing user found', async () => {
      mockOAuthService.findByProvider.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue(mockUser) },
          oAuthProvider: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.findOrCreateGoogleUser(mockGoogleProfile);

      expect(result.id).toBe('user-uuid');
      expect(result.email).toBe('google@example.com');
    });

    it('should throw if email is not verified and no existing user', async () => {
      const unverifiedProfile = { ...mockGoogleProfile, emailVerified: false };
      mockOAuthService.findByProvider.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findOrCreateGoogleUser(unverifiedProfile)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('findOrCreateTelegramUser()', () => {
    const mockTelegramProfile = {
      telegramId: '123456789',
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
      photoUrl: 'https://t.me/i/userpic/320/photo.jpg',
    };

    const mockUser = {
      id: 'user-uuid',
      email: 'telegram_123456789@telegram.user',
      name: 'John Doe',
      passwordHash: null,
      defaultCurrency: 'USD',
      locale: 'en',
      timezone: 'UTC',
      isActive: true,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should create new user when no existing OAuth provider found', async () => {
      mockOAuthService.findByProvider.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue(mockUser) },
          oAuthProvider: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.findOrCreateTelegramUser(mockTelegramProfile);

      expect(mockOAuthService.findByProvider).toHaveBeenCalledWith('telegram', '123456789');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(result.id).toBe('user-uuid');
      expect(result.email).toBe('telegram_123456789@telegram.user');
      expect(result.name).toBe('John Doe');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should return existing linked user when OAuth provider found', async () => {
      mockOAuthService.findByProvider.mockResolvedValue({
        id: 'oauth-uuid',
        provider: 'telegram',
        providerId: '123456789',
        userId: 'user-uuid',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findOrCreateTelegramUser(mockTelegramProfile);

      expect(result.id).toBe('user-uuid');
      expect(result.email).toBe('telegram_123456789@telegram.user');
      expect(result).not.toHaveProperty('passwordHash');
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should reject inactive user', async () => {
      mockOAuthService.findByProvider.mockResolvedValue({
        id: 'oauth-uuid',
        provider: 'telegram',
        providerId: '123456789',
        userId: 'user-uuid',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(service.findOrCreateTelegramUser(mockTelegramProfile)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        await service.findOrCreateTelegramUser(mockTelegramProfile);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Account is inactive',
            errorCode: AUTH_ERRORS.OAUTH_ACCOUNT_INACTIVE,
          }),
        );
      }
    });

    it('should handle missing optional fields (no lastName, no username, no photoUrl)', async () => {
      const minimalProfile = {
        telegramId: '999888777',
        firstName: 'Solo',
      };

      const minimalUser = {
        ...mockUser,
        id: 'minimal-uuid',
        email: 'telegram_999888777@telegram.user',
        name: 'Solo',
      };

      mockOAuthService.findByProvider.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          user: {
            create: jest.fn().mockImplementation(({ data }) => {
              expect(data.name).toBe('Solo');
              expect(data.email).toBe('telegram_999888777@telegram.user');
              return Promise.resolve(minimalUser);
            }),
          },
          oAuthProvider: {
            create: jest.fn().mockImplementation(({ data }) => {
              expect(data.metadata).toEqual({
                username: null,
                firstName: 'Solo',
                lastName: null,
              });
              return Promise.resolve({});
            }),
          },
        };
        return fn(tx);
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.findOrCreateTelegramUser(minimalProfile);

      expect(result.id).toBe('minimal-uuid');
      expect(result.name).toBe('Solo');
    });

    it('should throw USER_NOT_FOUND when OAuth provider exists but user does not', async () => {
      mockOAuthService.findByProvider.mockResolvedValue({
        id: 'oauth-uuid',
        provider: 'telegram',
        providerId: '123456789',
        userId: 'deleted-user-uuid',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findOrCreateTelegramUser(mockTelegramProfile)).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        await service.findOrCreateTelegramUser(mockTelegramProfile);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'User not found',
            errorCode: AUTH_ERRORS.USER_NOT_FOUND,
          }),
        );
      }
    });

    it('should create audit log with provider telegram', async () => {
      mockOAuthService.findByProvider.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue(mockUser) },
          oAuthProvider: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.findOrCreateTelegramUser(mockTelegramProfile);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          action: 'USER_REGISTERED_OAUTH',
          entity: 'User',
          entityId: mockUser.id,
          details: { email: mockUser.email, provider: 'telegram' },
        },
      });
    });
  });

  describe('getConnectedAccounts()', () => {
    it('should return providers list with hasPassword flag when user has password', async () => {
      const createdAt = new Date('2026-03-01T00:00:00Z');
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@example.com',
        passwordHash: '$argon2id$hashed',
        oauthProviders: [
          {
            provider: 'google',
            name: 'Google User',
            email: 'google@example.com',
            avatarUrl: 'https://photo.url',
            createdAt,
          },
          {
            provider: 'telegram',
            name: 'John Doe',
            email: null,
            avatarUrl: null,
            createdAt,
          },
        ],
      });

      const result = await service.getConnectedAccounts('user-uuid');

      expect(result.hasPassword).toBe(true);
      expect(result.providers).toHaveLength(2);
      expect(result.providers[0]).toEqual({
        provider: 'google',
        name: 'Google User',
        email: 'google@example.com',
        avatarUrl: 'https://photo.url',
        connectedAt: createdAt,
      });
      expect(result.providers[1]).toEqual({
        provider: 'telegram',
        name: 'John Doe',
        email: null,
        avatarUrl: null,
        connectedAt: createdAt,
      });
    });

    it('should return empty providers for user with no OAuth', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@example.com',
        passwordHash: '$argon2id$hashed',
        oauthProviders: [],
      });

      const result = await service.getConnectedAccounts('user-uuid');

      expect(result.hasPassword).toBe(true);
      expect(result.providers).toEqual([]);
    });

    it('should return hasPassword false for OAuth-only user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        email: 'telegram_123@telegram.user',
        passwordHash: null,
        oauthProviders: [
          {
            provider: 'telegram',
            name: 'Tg User',
            email: null,
            avatarUrl: null,
            createdAt: new Date(),
          },
        ],
      });

      const result = await service.getConnectedAccounts('user-uuid');

      expect(result.hasPassword).toBe(false);
      expect(result.providers).toHaveLength(1);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getConnectedAccounts('non-existent')).rejects.toThrow(
        UnauthorizedException,
      );

      try {
        await service.getConnectedAccounts('non-existent');
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'User not found',
            errorCode: AUTH_ERRORS.USER_NOT_FOUND,
          }),
        );
      }
    });
  });

  describe('linkTelegramToUser()', () => {
    const telegramDto = {
      id: 123456789,
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
      photo_url: 'https://t.me/photo.jpg',
      auth_date: Math.floor(Date.now() / 1000),
      hash: 'valid_hash',
    };

    const connectedAccountsUser = {
      id: 'user-uuid',
      email: 'test@example.com',
      passwordHash: '$argon2id$hashed',
      oauthProviders: [
        {
          provider: 'telegram',
          name: 'John Doe',
          email: null,
          avatarUrl: 'https://t.me/photo.jpg',
          createdAt: new Date(),
        },
      ],
    };

    it('should link Telegram to user when not already linked', async () => {
      mockOAuthService.findByProvider.mockResolvedValue(null);
      mockOAuthService.createOAuthProvider.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.user.findUnique.mockResolvedValue(connectedAccountsUser);

      const result = await service.linkTelegramToUser('user-uuid', telegramDto);

      expect(mockOAuthService.findByProvider).toHaveBeenCalledWith('telegram', '123456789');
      expect(mockOAuthService.createOAuthProvider).toHaveBeenCalledWith({
        provider: 'telegram',
        providerId: '123456789',
        userId: 'user-uuid',
        name: 'John Doe',
        avatarUrl: 'https://t.me/photo.jpg',
        metadata: {
          username: 'johndoe',
          firstName: 'John',
          lastName: 'Doe',
        },
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid',
          action: 'OAUTH_PROVIDER_LINKED',
          entity: 'OAuthProvider',
          entityId: 'user-uuid',
          details: { provider: 'telegram', telegramId: '123456789' },
        },
      });
      expect(result.hasPassword).toBe(true);
      expect(result.providers).toHaveLength(1);
    });

    it('should return existing connected accounts if already linked to same user', async () => {
      mockOAuthService.findByProvider.mockResolvedValue({
        id: 'oauth-uuid',
        provider: 'telegram',
        providerId: '123456789',
        userId: 'user-uuid',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(connectedAccountsUser);

      const result = await service.linkTelegramToUser('user-uuid', telegramDto);

      expect(mockOAuthService.createOAuthProvider).not.toHaveBeenCalled();
      expect(result.hasPassword).toBe(true);
    });

    it('should throw ConflictException if linked to different user', async () => {
      mockOAuthService.findByProvider.mockResolvedValue({
        id: 'oauth-uuid',
        provider: 'telegram',
        providerId: '123456789',
        userId: 'other-user-uuid',
      });

      await expect(service.linkTelegramToUser('user-uuid', telegramDto)).rejects.toThrow(
        ConflictException,
      );

      try {
        await service.linkTelegramToUser('user-uuid', telegramDto);
      } catch (error) {
        const response = (error as ConflictException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'This Telegram account is already linked to another user',
            errorCode: AUTH_ERRORS.TELEGRAM_ALREADY_LINKED,
          }),
        );
      }
    });
  });

  describe('unlinkProvider()', () => {
    it('should unlink a provider and return updated connected accounts', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          passwordHash: '$argon2id$hashed',
          oauthProviders: [
            { provider: 'google', id: 'oauth-google-id' },
            { provider: 'telegram', id: 'oauth-telegram-id' },
          ],
        })
        .mockResolvedValueOnce({
          id: 'user-uuid',
          email: 'test@example.com',
          passwordHash: '$argon2id$hashed',
          oauthProviders: [
            {
              provider: 'google',
              name: 'Google User',
              email: 'google@example.com',
              avatarUrl: null,
              createdAt: new Date(),
            },
          ],
        });
      mockPrismaService.oAuthProvider.delete.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.unlinkProvider('user-uuid', 'telegram');

      expect(mockPrismaService.oAuthProvider.delete).toHaveBeenCalledWith({
        where: { id: 'oauth-telegram-id' },
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid',
          action: 'OAUTH_PROVIDER_UNLINKED',
          entity: 'OAuthProvider',
          entityId: 'oauth-telegram-id',
          details: { provider: 'telegram' },
        },
      });
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0].provider).toBe('google');
    });

    it('should throw NotFoundException if provider not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        passwordHash: '$argon2id$hashed',
        oauthProviders: [{ provider: 'google', id: 'oauth-google-id' }],
      });

      await expect(service.unlinkProvider('user-uuid', 'telegram')).rejects.toThrow(
        NotFoundException,
      );

      try {
        await service.unlinkProvider('user-uuid', 'telegram');
      } catch (error) {
        const response = (error as NotFoundException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Provider telegram is not linked',
            errorCode: AUTH_ERRORS.PROVIDER_NOT_FOUND,
          }),
        );
      }
    });

    it('should throw BadRequestException if last auth method (no password, one provider)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        passwordHash: null,
        oauthProviders: [{ provider: 'telegram', id: 'oauth-telegram-id' }],
      });

      await expect(service.unlinkProvider('user-uuid', 'telegram')).rejects.toThrow(
        BadRequestException,
      );

      try {
        await service.unlinkProvider('user-uuid', 'telegram');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Cannot unlink the last authentication method',
            errorCode: AUTH_ERRORS.CANNOT_UNLINK_LAST_AUTH,
          }),
        );
      }
    });

    it('should allow unlink when password exists even if only one provider', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          passwordHash: '$argon2id$hashed',
          oauthProviders: [{ provider: 'telegram', id: 'oauth-telegram-id' }],
        })
        .mockResolvedValueOnce({
          id: 'user-uuid',
          email: 'test@example.com',
          passwordHash: '$argon2id$hashed',
          oauthProviders: [],
        });
      mockPrismaService.oAuthProvider.delete.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.unlinkProvider('user-uuid', 'telegram');

      expect(mockPrismaService.oAuthProvider.delete).toHaveBeenCalledWith({
        where: { id: 'oauth-telegram-id' },
      });
      expect(result.hasPassword).toBe(true);
      expect(result.providers).toEqual([]);
    });

    it('should allow unlink when other providers exist (no password)', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          passwordHash: null,
          oauthProviders: [
            { provider: 'google', id: 'oauth-google-id' },
            { provider: 'telegram', id: 'oauth-telegram-id' },
          ],
        })
        .mockResolvedValueOnce({
          id: 'user-uuid',
          email: 'test@example.com',
          passwordHash: null,
          oauthProviders: [
            {
              provider: 'google',
              name: 'Google User',
              email: 'google@example.com',
              avatarUrl: null,
              createdAt: new Date(),
            },
          ],
        });
      mockPrismaService.oAuthProvider.delete.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.unlinkProvider('user-uuid', 'telegram');

      expect(mockPrismaService.oAuthProvider.delete).toHaveBeenCalled();
      expect(result.hasPassword).toBe(false);
      expect(result.providers).toHaveLength(1);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.unlinkProvider('non-existent', 'telegram')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
