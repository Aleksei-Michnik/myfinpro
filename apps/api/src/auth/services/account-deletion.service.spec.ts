import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';
import { AccountDeletionService } from './account-deletion.service';
import { RefreshTokenService } from './refresh-token.service';

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockMailService = {
    sendAccountDeletionConfirmation: jest.fn(),
    sendAccountDeletionCancelled: jest.fn(),
  };

  const mockRefreshTokenService = {
    revokeAllUserTokens: jest.fn(),
  };

  const activeUser = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    isActive: true,
    locale: 'en',
    deletedAt: null,
    scheduledDeletionAt: null,
    passwordHash: 'hashed',
    defaultCurrency: 'USD',
    timezone: 'UTC',
    emailVerified: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
      ],
    }).compile();

    service = module.get<AccountDeletionService>(AccountDeletionService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('requestDeletion()', () => {
    it('should set isActive=false and scheduledDeletionAt', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser });
      mockPrisma.user.update.mockResolvedValue({});
      mockRefreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);
      mockMailService.sendAccountDeletionConfirmation.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.requestDeletion('user-1', 'user@example.com');

      expect(result.scheduledDeletionAt).toBeInstanceOf(Date);
      // Should be approximately 30 days from now
      const diff = result.scheduledDeletionAt.getTime() - Date.now();
      expect(diff).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(31 * 24 * 60 * 60 * 1000);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            isActive: false,
            deletedAt: expect.any(Date),
            scheduledDeletionAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should throw CONFIRMATION_MISMATCH when email does not match', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser });

      await expect(service.requestDeletion('user-1', 'wrong@example.com')).rejects.toThrow(
        BadRequestException,
      );

      try {
        await service.requestDeletion('user-1', 'wrong@example.com');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.ACCOUNT_DELETION_CONFIRMATION_MISMATCH,
          }),
        );
      }
    });

    it('should throw ALREADY_DELETED for already deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        isActive: false,
      });

      await expect(service.requestDeletion('user-1', 'user@example.com')).rejects.toThrow(
        BadRequestException,
      );

      try {
        await service.requestDeletion('user-1', 'user@example.com');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.ACCOUNT_ALREADY_DELETED,
          }),
        );
      }
    });

    it('should revoke all refresh tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser });
      mockPrisma.user.update.mockResolvedValue({});
      mockRefreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);
      mockMailService.sendAccountDeletionConfirmation.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.requestDeletion('user-1', 'user@example.com');

      expect(mockRefreshTokenService.revokeAllUserTokens).toHaveBeenCalledWith('user-1');
    });

    it('should send deletion confirmation email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser });
      mockPrisma.user.update.mockResolvedValue({});
      mockRefreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);
      mockMailService.sendAccountDeletionConfirmation.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.requestDeletion('user-1', 'user@example.com');

      expect(mockMailService.sendAccountDeletionConfirmation).toHaveBeenCalledWith(
        'user@example.com',
        'Test User',
        expect.any(Date),
        'login-to-cancel',
        'en',
      );
    });

    it('should create audit log', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser });
      mockPrisma.user.update.mockResolvedValue({});
      mockRefreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);
      mockMailService.sendAccountDeletionConfirmation.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.requestDeletion('user-1', 'user@example.com');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            action: 'ACCOUNT_DELETION_REQUESTED',
          }),
        }),
      );
    });

    it('should validate confirmation email case-insensitively', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser });
      mockPrisma.user.update.mockResolvedValue({});
      mockRefreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);
      mockMailService.sendAccountDeletionConfirmation.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Should not throw — case-insensitive match
      const result = await service.requestDeletion('user-1', 'USER@EXAMPLE.COM');
      expect(result.scheduledDeletionAt).toBeInstanceOf(Date);
    });
  });

  describe('cancelDeletion()', () => {
    const deletedUser = {
      ...activeUser,
      isActive: false,
      deletedAt: new Date(),
      scheduledDeletionAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
    };

    it('should reactivate account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...deletedUser });
      mockPrisma.user.update.mockResolvedValue({});
      mockMailService.sendAccountDeletionCancelled.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.cancelDeletion('user-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            isActive: true,
            deletedAt: null,
            scheduledDeletionAt: null,
          }),
        }),
      );
    });

    it('should throw ACCOUNT_NOT_DELETED for non-deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser });

      await expect(service.cancelDeletion('user-1')).rejects.toThrow(BadRequestException);

      try {
        await service.cancelDeletion('user-1');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.ACCOUNT_NOT_DELETED,
          }),
        );
      }
    });

    it('should throw DELETION_GRACE_PERIOD_EXPIRED when grace period is past', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...deletedUser,
        scheduledDeletionAt: new Date(Date.now() - 1000), // In the past
      });

      await expect(service.cancelDeletion('user-1')).rejects.toThrow(BadRequestException);

      try {
        await service.cancelDeletion('user-1');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.DELETION_GRACE_PERIOD_EXPIRED,
          }),
        );
      }
    });

    it('should send cancellation email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...deletedUser });
      mockPrisma.user.update.mockResolvedValue({});
      mockMailService.sendAccountDeletionCancelled.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.cancelDeletion('user-1');

      expect(mockMailService.sendAccountDeletionCancelled).toHaveBeenCalledWith(
        'user@example.com',
        'Test User',
        'en',
      );
    });
  });

  describe('reactivateOnLogin()', () => {
    it('should reactivate soft-deleted user within grace period', async () => {
      const futureDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        isActive: false,
        scheduledDeletionAt: futureDate,
        locale: 'en',
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockMailService.sendAccountDeletionCancelled.mockResolvedValue(undefined);

      const result = await service.reactivateOnLogin('user-1');

      expect(result).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            isActive: true,
            deletedAt: null,
            scheduledDeletionAt: null,
          }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ACCOUNT_REACTIVATED_VIA_LOGIN',
          }),
        }),
      );
    });

    it('should return false for truly disabled user (no scheduledDeletionAt)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        isActive: false,
        scheduledDeletionAt: null,
        locale: 'en',
      });

      const result = await service.reactivateOnLogin('user-1');

      expect(result).toBe(false);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should return false when grace period has expired', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        isActive: false,
        scheduledDeletionAt: new Date(Date.now() - 1000), // In the past
        locale: 'en',
      });

      const result = await service.reactivateOnLogin('user-1');

      expect(result).toBe(false);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should return false for active user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        isActive: true,
        scheduledDeletionAt: null,
        locale: 'en',
      });

      const result = await service.reactivateOnLogin('user-1');

      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.reactivateOnLogin('nonexistent');

      expect(result).toBe(false);
    });
  });
});
