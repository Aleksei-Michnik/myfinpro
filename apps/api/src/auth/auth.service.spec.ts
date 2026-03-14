import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

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

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: TokenService, useValue: mockTokenService },
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
      expect((result.user as any).passwordHash).toBeUndefined();
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

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(registerDto, mockResponse)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto, mockResponse)).rejects.toThrow(
        'An account with this email already exists',
      );
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
      expect(result.id).toBe('test-uuid-1234');
      expect(result.email).toBe('test@example.com');
      expect(result.passwordHash).toBeUndefined();
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
    const mockUser = {
      id: 'test-uuid-1234',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
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

      expect((result.user as any).passwordHash).toBeUndefined();
    });
  });
});
