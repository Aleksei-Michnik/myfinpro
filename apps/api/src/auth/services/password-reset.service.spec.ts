import * as crypto from 'crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  const mockUser = {
    id: 'user-uuid-1',
    email: 'test@example.com',
    name: 'Test User',
    locale: 'en',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$hash',
  };

  const mockOAuthUser = {
    id: 'oauth-user-uuid',
    email: 'oauth@example.com',
    name: 'OAuth User',
    locale: 'en',
    passwordHash: null,
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockMailService = {
    sendPasswordResetEmail: jest.fn(),
  };

  const mockPasswordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  };

  const mockRefreshTokenService = {
    revokeAllUserTokens: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: RefreshTokenService, useValue: mockRefreshTokenService },
      ],
    }).compile();

    service = module.get<PasswordResetService>(PasswordResetService);

    jest.clearAllMocks();
  });

  describe('forgotPassword()', () => {
    it('should generate token and send email for existing user with password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'token-id',
        tokenHash: 'hashed',
        userId: mockUser.id,
      });
      mockMailService.sendPasswordResetEmail.mockResolvedValue(undefined);

      await service.forgotPassword('test@example.com');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: {
          id: true,
          email: true,
          name: true,
          locale: true,
          passwordHash: true,
        },
      });
      expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, usedAt: null },
      });
      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUser.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        mockUser.email,
        mockUser.name,
        expect.any(String), // raw token
        'en',
      );
    });

    it('should invalidate previous tokens for same user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'new-token-id',
        tokenHash: 'hashed',
        userId: mockUser.id,
      });
      mockMailService.sendPasswordResetEmail.mockResolvedValue(undefined);

      await service.forgotPassword('test@example.com');

      expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, usedAt: null },
      });
    });

    it('should do nothing for non-existent email (no error)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.forgotPassword('nonexistent@example.com')).resolves.toBeUndefined();

      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should do nothing for OAuth-only user (no error)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockOAuthUser);

      await expect(service.forgotPassword('oauth@example.com')).resolves.toBeUndefined();

      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should normalize email to lowercase and trim', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await service.forgotPassword('  TEST@EXAMPLE.COM  ');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: expect.any(Object),
      });
    });
  });

  describe('resetPassword()', () => {
    const rawToken = 'test-uuid-token';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const validTokenRecord = {
      id: 'token-record-id',
      tokenHash,
      userId: mockUser.id,
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      usedAt: null,
      createdAt: new Date(),
      user: mockUser,
    };

    it('should reset password and revoke sessions for valid token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRecord);
      mockPasswordService.hash.mockResolvedValue('$argon2id$new-hash');
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);
      mockRefreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.resetPassword(rawToken, 'NewSecurePass123');

      expect(result).toEqual({ userId: mockUser.id });
      expect(mockPasswordService.hash).toHaveBeenCalledWith('NewSecurePass123');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockRefreshTokenService.revokeAllUserTokens).toHaveBeenCalledWith(mockUser.id);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUser.id,
          action: 'PASSWORD_RESET',
          entity: 'User',
          entityId: mockUser.id,
        }),
      });
    });

    it('should throw RESET_TOKEN_EXPIRED for expired token', async () => {
      const expiredTokenRecord = {
        ...validTokenRecord,
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      };
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(expiredTokenRecord);

      try {
        await service.resetPassword(rawToken, 'NewSecurePass123');
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.RESET_TOKEN_EXPIRED,
          }),
        );
      }
    });

    it('should throw RESET_TOKEN_USED for already used token', async () => {
      const usedTokenRecord = {
        ...validTokenRecord,
        usedAt: new Date(),
      };
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(usedTokenRecord);

      try {
        await service.resetPassword(rawToken, 'NewSecurePass123');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.RESET_TOKEN_USED,
          }),
        );
      }
    });

    it('should throw RESET_TOKEN_INVALID for non-existent token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

      try {
        await service.resetPassword('non-existent-token', 'NewSecurePass123');
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.RESET_TOKEN_INVALID,
          }),
        );
      }
    });

    it('should hash new password with passwordService (Argon2)', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRecord);
      mockPasswordService.hash.mockResolvedValue('$argon2id$new-hashed-password');
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);
      mockRefreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.resetPassword(rawToken, 'StrongPassword1');

      expect(mockPasswordService.hash).toHaveBeenCalledWith('StrongPassword1');

      // Verify the transaction includes the hashed password update
      const transactionCalls = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionCalls).toHaveLength(2);
    });
  });
});
