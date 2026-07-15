import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountMergeService } from './account-merge.service';

describe('AccountMergeService', () => {
  let service: AccountMergeService;

  const targetUser = {
    id: 'target-uuid',
    email: 'telegram_123@telegram.user',
    passwordHash: null,
    emailVerified: false,
  };

  const sourceUser = {
    id: 'source-uuid',
    email: 'real@example.com',
    passwordHash: '$argon2id$hashed',
    emailVerified: true,
  };

  /** Fresh transaction-client mock for each test. */
  function createTx() {
    return {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      oAuthProvider: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      groupMembership: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      group: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      groupInviteToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      category: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      transaction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      transactionAttribution: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      transactionStar: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      transactionComment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      transactionDocument: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      receipt: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      receiptItem: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
  }

  let tx: ReturnType<typeof createTx>;

  const mockPrismaService = {
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountMergeService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<AccountMergeService>(AccountMergeService);

    jest.clearAllMocks();
    tx = createTx();
    tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'target-uuid') return Promise.resolve({ ...targetUser });
      if (where.id === 'source-uuid') return Promise.resolve({ ...sourceUser });
      return Promise.resolve(null);
    });
    mockPrismaService.$transaction.mockImplementation(async (fn: Function) => fn(tx));
  });

  describe('isPlaceholderEmail()', () => {
    it('detects the synthetic Telegram address', () => {
      expect(AccountMergeService.isPlaceholderEmail('telegram_123@telegram.user')).toBe(true);
      expect(AccountMergeService.isPlaceholderEmail('real@example.com')).toBe(false);
    });
  });

  describe('mergeUsers()', () => {
    it('is a no-op when target and source are the same user', async () => {
      await service.mergeUsers('same-uuid', 'same-uuid');

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when either user is missing', async () => {
      await expect(service.mergeUsers('target-uuid', 'missing-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('moves OAuth providers, transactions, and satellites to the target user', async () => {
      await service.mergeUsers('target-uuid', 'source-uuid');

      const reassignment = {
        where: expect.objectContaining({ userId: 'source-uuid' }),
        data: { userId: 'target-uuid' },
      };
      expect(tx.oAuthProvider.updateMany).toHaveBeenCalledWith(reassignment);
      expect(tx.groupMembership.updateMany).toHaveBeenCalledWith(reassignment);
      expect(tx.transactionAttribution.updateMany).toHaveBeenCalledWith(reassignment);
      expect(tx.transactionStar.updateMany).toHaveBeenCalledWith(reassignment);
      expect(tx.transactionComment.updateMany).toHaveBeenCalledWith(reassignment);
      expect(tx.transaction.updateMany).toHaveBeenCalledWith({
        where: { createdById: 'source-uuid' },
        data: { createdById: 'target-uuid' },
      });
      expect(tx.transactionDocument.updateMany).toHaveBeenCalledWith({
        where: { uploadedById: 'source-uuid' },
        data: { uploadedById: 'target-uuid' },
      });
      expect(tx.receipt.updateMany).toHaveBeenCalledWith({
        where: { uploadedById: 'source-uuid' },
        data: { uploadedById: 'target-uuid' },
      });
      expect(tx.group.updateMany).toHaveBeenCalledWith({
        where: { createdById: 'source-uuid' },
        data: { createdById: 'target-uuid' },
      });
    });

    it('drops duplicate group memberships before reassigning', async () => {
      tx.groupMembership.findMany.mockResolvedValue([{ groupId: 'group-a' }]);

      await service.mergeUsers('target-uuid', 'source-uuid');

      expect(tx.groupMembership.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'source-uuid', groupId: { in: ['group-a'] } },
      });
    });

    it('merges duplicate categories by repointing transactions and receipt items', async () => {
      tx.category.findMany
        .mockResolvedValueOnce([
          { id: 'src-cat', slug: 'groceries', direction: 'OUT' },
          { id: 'src-cat-unique', slug: 'hobby', direction: 'OUT' },
        ])
        .mockResolvedValueOnce([{ id: 'tgt-cat', slug: 'groceries', direction: 'OUT' }]);

      await service.mergeUsers('target-uuid', 'source-uuid');

      // Duplicate slug+direction → repoint and delete
      expect(tx.transaction.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'src-cat' },
        data: { categoryId: 'tgt-cat' },
      });
      expect(tx.receiptItem.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'src-cat' },
        data: { categoryId: 'tgt-cat' },
      });
      expect(tx.category.delete).toHaveBeenCalledWith({ where: { id: 'src-cat' } });
      // Unique category → just change owner
      expect(tx.category.update).toHaveBeenCalledWith({
        where: { id: 'src-cat-unique' },
        data: { ownerId: 'target-uuid' },
      });
    });

    it('drops duplicate stars and attributions before reassigning', async () => {
      tx.transactionStar.findMany
        .mockResolvedValueOnce([
          { id: 'src-star-dup', transactionId: 'pay-1' },
          { id: 'src-star-new', transactionId: 'pay-2' },
        ])
        .mockResolvedValueOnce([{ transactionId: 'pay-1' }]);
      tx.transactionAttribution.findMany
        .mockResolvedValueOnce([{ id: 'src-attr-dup', transactionId: 'pay-1', scopeType: 'user' }])
        .mockResolvedValueOnce([{ transactionId: 'pay-1', scopeType: 'user' }]);

      await service.mergeUsers('target-uuid', 'source-uuid');

      expect(tx.transactionStar.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['src-star-dup'] } },
      });
      expect(tx.transactionAttribution.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['src-attr-dup'] } },
      });
    });

    it('adopts real email and password from the source when the target lacks them', async () => {
      await service.mergeUsers('target-uuid', 'source-uuid');

      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'source-uuid' } });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'target-uuid' },
        data: {
          email: 'real@example.com',
          emailVerified: true,
          passwordHash: '$argon2id$hashed',
        },
      });
    });

    it('keeps target credentials when it already has a real email and password', async () => {
      tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'target-uuid') {
          return Promise.resolve({
            ...targetUser,
            email: 'existing@example.com',
            passwordHash: '$argon2id$mine',
          });
        }
        if (where.id === 'source-uuid') return Promise.resolve({ ...sourceUser });
        return Promise.resolve(null);
      });

      await service.mergeUsers('target-uuid', 'source-uuid');

      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('never adopts a placeholder email from the source', async () => {
      tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'target-uuid') return Promise.resolve({ ...targetUser });
        if (where.id === 'source-uuid') {
          return Promise.resolve({
            ...sourceUser,
            email: 'telegram_999@telegram.user',
            passwordHash: null,
          });
        }
        return Promise.resolve(null);
      });

      await service.mergeUsers('target-uuid', 'source-uuid');

      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('writes an audit log entry for the merge', async () => {
      await service.mergeUsers('target-uuid', 'source-uuid');

      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'target-uuid',
          action: 'ACCOUNT_MERGED',
          entity: 'User',
          entityId: 'target-uuid',
          details: {
            sourceUserId: 'source-uuid',
            adoptedEmail: true,
            adoptedPassword: true,
          },
        },
      });
    });
  });
});
