import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountCleanupService } from './account-cleanup.service';

describe('AccountCleanupService', () => {
  let service: AccountCleanupService;

  const mockDeleteManyResult = { count: 0 };

  const mockTransaction = jest.fn();
  const mockFindMany = jest.fn();

  // Silence NestJS logger output during tests
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    mockTransaction.mockReset();
    mockFindMany.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountCleanupService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: mockFindMany,
              deleteMany: jest.fn().mockResolvedValue(mockDeleteManyResult),
            },
            oAuthProvider: {
              deleteMany: jest.fn().mockResolvedValue(mockDeleteManyResult),
            },
            refreshToken: {
              deleteMany: jest.fn().mockResolvedValue(mockDeleteManyResult),
            },
            emailVerificationToken: {
              deleteMany: jest.fn().mockResolvedValue(mockDeleteManyResult),
            },
            passwordResetToken: {
              deleteMany: jest.fn().mockResolvedValue(mockDeleteManyResult),
            },
            $transaction: mockTransaction,
          },
        },
      ],
    }).compile();

    service = module.get<AccountCleanupService>(AccountCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleExpiredAccounts', () => {
    it('should skip cleanup when no expired accounts are found', async () => {
      mockFindMany.mockResolvedValue([]);

      await service.handleExpiredAccounts();

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          deletedAt: {
            not: null,
            lte: expect.any(Date),
          },
        },
        select: { id: true, email: true, deletedAt: true },
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should find and delete accounts where deletedAt is older than 30 days', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 31);

      const expiredAccounts = [
        { id: 'user-1', email: 'user1@example.com', deletedAt: expiredDate },
        { id: 'user-2', email: 'user2@example.com', deletedAt: expiredDate },
      ];

      mockFindMany.mockResolvedValue(expiredAccounts);
      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          oAuthProvider: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
          refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
          emailVerificationToken: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
          passwordResetToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
          user: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
        };
        return callback(tx);
      });

      await service.handleExpiredAccounts();

      expect(mockFindMany).toHaveBeenCalled();
      expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should delete all related records in the correct order within a transaction', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 35);

      const expiredAccounts = [
        { id: 'user-1', email: 'user1@example.com', deletedAt: expiredDate },
      ];

      mockFindMany.mockResolvedValue(expiredAccounts);

      const callOrder: string[] = [];

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          oAuthProvider: {
            deleteMany: jest.fn().mockImplementation(() => {
              callOrder.push('oAuthProvider');
              return Promise.resolve({ count: 1 });
            }),
          },
          refreshToken: {
            deleteMany: jest.fn().mockImplementation(() => {
              callOrder.push('refreshToken');
              return Promise.resolve({ count: 2 });
            }),
          },
          emailVerificationToken: {
            deleteMany: jest.fn().mockImplementation(() => {
              callOrder.push('emailVerificationToken');
              return Promise.resolve({ count: 0 });
            }),
          },
          passwordResetToken: {
            deleteMany: jest.fn().mockImplementation(() => {
              callOrder.push('passwordResetToken');
              return Promise.resolve({ count: 0 });
            }),
          },
          user: {
            deleteMany: jest.fn().mockImplementation(() => {
              callOrder.push('user');
              return Promise.resolve({ count: 1 });
            }),
          },
        };
        return callback(tx);
      });

      await service.handleExpiredAccounts();

      // Related records should be deleted before the user record
      expect(callOrder).toEqual([
        'oAuthProvider',
        'refreshToken',
        'emailVerificationToken',
        'passwordResetToken',
        'user',
      ]);
    });

    it('should pass correct user IDs to the transaction delete operations', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 40);

      const expiredAccounts = [
        { id: 'user-abc', email: 'abc@test.com', deletedAt: expiredDate },
        { id: 'user-def', email: 'def@test.com', deletedAt: expiredDate },
      ];

      mockFindMany.mockResolvedValue(expiredAccounts);

      const txMocks = {
        oAuthProvider: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        emailVerificationToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        passwordResetToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        user: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      };

      mockTransaction.mockImplementation(async (callback) => callback(txMocks));

      await service.handleExpiredAccounts();

      const expectedWhere = { where: { userId: { in: ['user-abc', 'user-def'] } } };
      expect(txMocks.oAuthProvider.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(txMocks.refreshToken.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(txMocks.emailVerificationToken.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(txMocks.passwordResetToken.deleteMany).toHaveBeenCalledWith(expectedWhere);
      expect(txMocks.user.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-abc', 'user-def'] } },
      });
    });

    it('should NOT delete recently soft-deleted accounts (within 30-day window)', async () => {
      // Return empty because the query only matches deletedAt <= cutoff
      mockFindMany.mockResolvedValue([]);

      await service.handleExpiredAccounts();

      // Verify the cutoff date is approximately 30 days ago
      const call = mockFindMany.mock.calls[0][0];
      const cutoffDate = call.where.deletedAt.lte as Date;
      const now = new Date();
      const daysDiff = Math.round((now.getTime() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBe(30);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully without crashing', async () => {
      mockFindMany.mockRejectedValue(new Error('Database connection failed'));

      // Should not throw
      await expect(service.handleExpiredAccounts()).resolves.not.toThrow();
    });

    it('should handle transaction errors gracefully without crashing', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 31);

      mockFindMany.mockResolvedValue([
        { id: 'user-1', email: 'user1@test.com', deletedAt: expiredDate },
      ]);

      mockTransaction.mockRejectedValue(new Error('Transaction deadlock'));

      // Should not throw
      await expect(service.handleExpiredAccounts()).resolves.not.toThrow();
    });

    it('should use the correct cutoff date (30 days ago)', async () => {
      mockFindMany.mockResolvedValue([]);

      const beforeCall = new Date();
      await service.handleExpiredAccounts();

      const call = mockFindMany.mock.calls[0][0];
      const cutoffDate = call.where.deletedAt.lte as Date;

      const expectedCutoff = new Date(beforeCall);
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);

      // Allow 1 second tolerance for test execution time
      const diffMs = Math.abs(cutoffDate.getTime() - expectedCutoff.getTime());
      expect(diffMs).toBeLessThan(1000);
    });

    it('should handle a single expired account correctly', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 60);

      const expiredAccounts = [
        { id: 'single-user', email: 'single@test.com', deletedAt: expiredDate },
      ];

      mockFindMany.mockResolvedValue(expiredAccounts);
      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          oAuthProvider: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
          refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
          emailVerificationToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
          passwordResetToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
          user: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        return callback(tx);
      });

      await service.handleExpiredAccounts();

      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error objects in catch block gracefully', async () => {
      mockFindMany.mockRejectedValue('string error');

      await expect(service.handleExpiredAccounts()).resolves.not.toThrow();
    });
  });
});
