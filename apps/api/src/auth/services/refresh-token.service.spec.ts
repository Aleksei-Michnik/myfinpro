import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  const mockPrismaService = {
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockTokenService = {
    hashToken: jest.fn().mockReturnValue('mock-hashed-token'),
    generateRefreshToken: jest.fn().mockReturnValue('new-refresh-token-uuid'),
    getRefreshExpirationDate: jest.fn().mockReturnValue(new Date('2026-03-21T00:00:00Z')),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TokenService, useValue: mockTokenService },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('rotateRefreshToken()', () => {
    const validToken = {
      id: 'token-id-1',
      tokenHash: 'old-hashed-token',
      userId: 'user-uuid-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      createdAt: new Date(),
      revokedAt: null,
      replacedBy: null,
      userAgent: 'TestAgent',
      ipAddress: '127.0.0.1',
    };

    it('should successfully rotate a valid token', async () => {
      mockTokenService.hashToken.mockReturnValue('old-hashed-token');
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(validToken);
      mockTokenService.generateRefreshToken.mockReturnValue('new-refresh-token-uuid');
      mockTokenService.hashToken
        .mockReturnValueOnce('old-hashed-token')
        .mockReturnValueOnce('new-hashed-token');
      mockPrismaService.refreshToken.create.mockResolvedValue({
        id: 'new-token-id',
        tokenHash: 'new-hashed-token',
        userId: validToken.userId,
      });
      mockPrismaService.refreshToken.update.mockResolvedValue({});

      const result = await service.rotateRefreshToken('old-token', '127.0.0.1', 'TestAgent');

      expect(result.userId).toBe('user-uuid-1');
      expect(result.newRefreshToken).toBe('new-refresh-token-uuid');

      // Verify old token was revoked
      expect(mockPrismaService.refreshToken.update).toHaveBeenCalledWith({
        where: { id: validToken.id },
        data: {
          revokedAt: expect.any(Date),
          replacedBy: 'new-token-id',
        },
      });

      // Verify new token was created
      expect(mockPrismaService.refreshToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: 'new-hashed-token',
          userId: validToken.userId,
          expiresAt: expect.any(Date),
          ipAddress: '127.0.0.1',
          userAgent: 'TestAgent',
        },
      });
    });

    it('should throw UnauthorizedException for invalid (non-existent) token', async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.rotateRefreshToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.rotateRefreshToken('invalid-token')).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('should detect token reuse and revoke all user tokens', async () => {
      const revokedToken = {
        ...validToken,
        revokedAt: new Date(), // Already revoked
        replacedBy: 'some-other-token-id',
      };

      mockPrismaService.refreshToken.findUnique.mockResolvedValue(revokedToken);
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await expect(
        service.rotateRefreshToken('reused-token', '192.168.1.1', 'SuspiciousAgent'),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.rotateRefreshToken('reused-token', '192.168.1.1', 'SuspiciousAgent'),
      ).rejects.toThrow('Token reuse detected. All sessions revoked.');

      // Verify ALL user tokens were revoked
      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: revokedToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });

      // Verify security audit event was logged
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: revokedToken.userId,
          action: 'TOKEN_REUSE_DETECTED',
          entity: 'RefreshToken',
          entityId: revokedToken.id,
          details: {
            revokedTokenId: revokedToken.id,
            ipAddress: '192.168.1.1',
            userAgent: 'SuspiciousAgent',
          },
        },
      });
    });

    it('should throw UnauthorizedException for expired token', async () => {
      const expiredToken = {
        ...validToken,
        expiresAt: new Date(Date.now() - 1000), // Already expired
      };

      mockPrismaService.refreshToken.findUnique.mockResolvedValue(expiredToken);

      await expect(service.rotateRefreshToken('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.rotateRefreshToken('expired-token')).rejects.toThrow(
        'Refresh token has expired',
      );
    });
  });

  describe('revokeToken()', () => {
    it('should revoke a single token by hash', async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeToken('some-token-hash');

      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: 'some-token-hash',
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });

    it('should not fail when token is already revoked (count = 0)', async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeToken('already-revoked-hash')).resolves.not.toThrow();
    });
  });

  describe('revokeAllUserTokens()', () => {
    it('should revoke all active tokens for a user', async () => {
      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 5 });

      await service.revokeAllUserTokens('user-uuid-1');

      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-1',
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });
  });

  describe('cleanupExpiredTokens()', () => {
    it('should delete tokens expired more than 30 days ago', async () => {
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.cleanupExpiredTokens();

      expect(result).toBe(10);
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });

      // Verify the date threshold is approximately 30 days ago
      const callArg = mockPrismaService.refreshToken.deleteMany.mock.calls[0][0];
      const thresholdDate = callArg.where.expiresAt.lt;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      // Allow 10 seconds tolerance for test execution time
      expect(Math.abs(thresholdDate.getTime() - thirtyDaysAgo.getTime())).toBeLessThan(10000);
    });
  });
});
