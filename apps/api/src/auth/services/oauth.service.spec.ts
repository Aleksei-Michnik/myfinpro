import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OAuthService } from './oauth.service';

describe('OAuthService', () => {
  let service: OAuthService;

  const mockPrismaService = {
    oAuthProvider: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OAuthService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByProvider()', () => {
    it('should find an OAuth provider by provider and providerId', async () => {
      const mockOAuth = {
        id: 'oauth-uuid',
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
        email: 'test@example.com',
      };

      mockPrismaService.oAuthProvider.findUnique.mockResolvedValue(mockOAuth);

      const result = await service.findByProvider('google', 'google-123');

      expect(result).toEqual(mockOAuth);
      expect(mockPrismaService.oAuthProvider.findUnique).toHaveBeenCalledWith({
        where: {
          provider_providerId: { provider: 'google', providerId: 'google-123' },
        },
      });
    });

    it('should return null when no OAuth provider found', async () => {
      mockPrismaService.oAuthProvider.findUnique.mockResolvedValue(null);

      const result = await service.findByProvider('google', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByProviderEmail()', () => {
    it('should find an OAuth provider by provider and email', async () => {
      const mockOAuth = {
        id: 'oauth-uuid',
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
        email: 'test@example.com',
      };

      mockPrismaService.oAuthProvider.findFirst.mockResolvedValue(mockOAuth);

      const result = await service.findByProviderEmail('google', 'test@example.com');

      expect(result).toEqual(mockOAuth);
      expect(mockPrismaService.oAuthProvider.findFirst).toHaveBeenCalledWith({
        where: { provider: 'google', email: 'test@example.com' },
      });
    });
  });

  describe('createOAuthProvider()', () => {
    it('should create a new OAuth provider', async () => {
      const mockCreated = {
        id: 'oauth-uuid',
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.oAuthProvider.create.mockResolvedValue(mockCreated);

      const result = await service.createOAuthProvider({
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
      });

      expect(result).toEqual(mockCreated);
      expect(mockPrismaService.oAuthProvider.create).toHaveBeenCalledWith({
        data: {
          provider: 'google',
          providerId: 'google-123',
          userId: 'user-uuid',
          email: 'test@example.com',
          name: 'Test User',
          avatarUrl: 'https://example.com/avatar.jpg',
          metadata: undefined,
        },
      });
    });

    it('should create OAuth provider with metadata', async () => {
      const mockCreated = {
        id: 'oauth-uuid',
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: null,
        metadata: { locale: 'en' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.oAuthProvider.create.mockResolvedValue(mockCreated);

      await service.createOAuthProvider({
        provider: 'google',
        providerId: 'google-123',
        userId: 'user-uuid',
        email: 'test@example.com',
        metadata: { locale: 'en' },
      });

      expect(mockPrismaService.oAuthProvider.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'google',
          providerId: 'google-123',
          userId: 'user-uuid',
        }),
      });
    });
  });

  describe('linkToUser()', () => {
    it('should link an OAuth provider to an existing user', async () => {
      const mockCreated = {
        id: 'oauth-uuid',
        provider: 'google',
        providerId: 'google-456',
        userId: 'existing-user-uuid',
        email: 'user@example.com',
        name: 'Existing User',
        avatarUrl: 'https://example.com/pic.jpg',
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.oAuthProvider.create.mockResolvedValue(mockCreated);

      const result = await service.linkToUser('google', 'google-456', 'existing-user-uuid', {
        email: 'user@example.com',
        name: 'Existing User',
        avatarUrl: 'https://example.com/pic.jpg',
      });

      expect(result).toEqual(mockCreated);
      expect(mockPrismaService.oAuthProvider.create).toHaveBeenCalledWith({
        data: {
          provider: 'google',
          providerId: 'google-456',
          userId: 'existing-user-uuid',
          email: 'user@example.com',
          name: 'Existing User',
          avatarUrl: 'https://example.com/pic.jpg',
          metadata: undefined,
        },
      });
    });
  });
});
