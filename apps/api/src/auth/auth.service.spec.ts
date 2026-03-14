import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './services/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockPasswordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PasswordService, useValue: mockPasswordService },
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

      const result = await service.register(registerDto);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.name).toBe('Test User');
      expect(result.user.defaultCurrency).toBe('USD');
      expect(result.user.locale).toBe('en');
      expect(result.accessToken).toBeDefined();
      // Must NOT expose passwordHash
      expect((result.user as any).passwordHash).toBeUndefined();
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto)).rejects.toThrow(
        'An account with this email already exists',
      );
    });

    it('should call PasswordService.hash() with the password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.register(registerDto);

      expect(mockPasswordService.hash).toHaveBeenCalledWith('SecurePass123');
    });

    it('should create an audit log entry', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$hashed');
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.register(registerDto);

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

      await service.register(registerDto);

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

      const result = await service.register(dtoWithOptions);

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
});
