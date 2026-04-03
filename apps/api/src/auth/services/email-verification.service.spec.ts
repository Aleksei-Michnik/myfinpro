import * as crypto from 'crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_ERRORS } from '../constants/auth-errors';
import { EmailVerificationService } from './email-verification.service';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  const mockPrismaService = {
    emailVerificationToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockMailService = {
    sendVerificationEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAndSendVerification()', () => {
    it('should generate token and store hash in DB', async () => {
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockMailService.sendVerificationEmail.mockResolvedValue(undefined);

      await service.createAndSendVerification('user-1', 'test@example.com', 'Test', 'en');

      expect(mockPrismaService.emailVerificationToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: expect.any(String),
          userId: 'user-1',
          expiresAt: expect.any(Date),
        }),
      });

      // Verify the hash is a SHA-256 hex string (64 chars)
      const createCall = mockPrismaService.emailVerificationToken.create.mock.calls[0][0];
      expect(createCall.data.tokenHash).toHaveLength(64);
    });

    it('should invalidate previous tokens for same user', async () => {
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockMailService.sendVerificationEmail.mockResolvedValue(undefined);

      await service.createAndSendVerification('user-1', 'test@example.com', 'Test', 'en');

      expect(mockPrismaService.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          usedAt: null,
        },
      });
    });

    it('should call mailService.sendVerificationEmail', async () => {
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockMailService.sendVerificationEmail.mockResolvedValue(undefined);

      await service.createAndSendVerification('user-1', 'test@example.com', 'Test User', 'he');

      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
        'Test User',
        expect.any(String), // raw token (UUID)
        'he',
      );

      // Verify the raw token is a valid UUID format
      const rawToken = mockMailService.sendVerificationEmail.mock.calls[0][2];
      expect(rawToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('verifyEmail()', () => {
    const rawToken = 'test-uuid-token';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    it('should set emailVerified to true for valid token', async () => {
      const tokenRecord = {
        id: 'token-id',
        tokenHash,
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 86400000), // 24h from now
        usedAt: null,
        createdAt: new Date(),
      };

      mockPrismaService.emailVerificationToken.findUnique.mockResolvedValue(tokenRecord);
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.verifyEmail(rawToken);

      expect(result).toEqual({ userId: 'user-1' });
      expect(mockPrismaService.emailVerificationToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash },
      });
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw VERIFICATION_TOKEN_EXPIRED for expired token', async () => {
      const tokenRecord = {
        id: 'token-id',
        tokenHash,
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000), // expired
        usedAt: null,
        createdAt: new Date(),
      };

      mockPrismaService.emailVerificationToken.findUnique.mockResolvedValue(tokenRecord);

      await expect(service.verifyEmail(rawToken)).rejects.toThrow(BadRequestException);

      try {
        await service.verifyEmail(rawToken);
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_EXPIRED,
          }),
        );
      }
    });

    it('should throw VERIFICATION_TOKEN_USED for already-used token', async () => {
      const tokenRecord = {
        id: 'token-id',
        tokenHash,
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: new Date(), // already used
        createdAt: new Date(),
      };

      mockPrismaService.emailVerificationToken.findUnique.mockResolvedValue(tokenRecord);

      await expect(service.verifyEmail(rawToken)).rejects.toThrow(BadRequestException);

      try {
        await service.verifyEmail(rawToken);
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_USED,
          }),
        );
      }
    });

    it('should throw VERIFICATION_TOKEN_INVALID for unknown token', async () => {
      mockPrismaService.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail('unknown-token')).rejects.toThrow(UnauthorizedException);

      try {
        await service.verifyEmail('unknown-token');
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.VERIFICATION_TOKEN_INVALID,
          }),
        );
      }
    });
  });

  describe('resendVerification()', () => {
    it('should send email for unverified user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
        locale: 'en',
        emailVerified: false,
      });
      mockPrismaService.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.emailVerificationToken.create.mockResolvedValue({});
      mockMailService.sendVerificationEmail.mockResolvedValue(undefined);

      await service.resendVerification('user-1');

      expect(mockMailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('should throw EMAIL_ALREADY_VERIFIED for verified user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
        locale: 'en',
        emailVerified: true,
      });

      await expect(service.resendVerification('user-1')).rejects.toThrow(BadRequestException);

      try {
        await service.resendVerification('user-1');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            errorCode: AUTH_ERRORS.EMAIL_ALREADY_VERIFIED,
          }),
        );
      }
    });
  });

  describe('hashToken()', () => {
    it('should return SHA-256 hex of raw token', () => {
      const token = 'test-token-value';
      const expected = crypto.createHash('sha256').update(token).digest('hex');

      const result = service.hashToken(token);

      expect(result).toBe(expected);
      expect(result).toHaveLength(64);
    });
  });
});
