import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { GROUP_ERRORS } from './constants/group-errors';
import { GroupService } from './group.service';

describe('GroupService', () => {
  let service: GroupService;

  const mockPrismaService = {
    group: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    groupMembership: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    groupInviteToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GroupService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<GroupService>(GroupService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createGroup()', () => {
    const userId = 'user-1';
    const dto = { name: 'My Family', type: 'family', defaultCurrency: 'USD' };
    const fakeGroup = {
      id: 'group-1',
      name: 'My Family',
      type: 'family',
      defaultCurrency: 'USD',
      createdById: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should create group and add creator as admin member', async () => {
      mockPrismaService.$transaction.mockImplementation(async (cb) => {
        const tx = {
          group: { create: jest.fn().mockResolvedValue(fakeGroup) },
          groupMembership: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.createGroup(userId, dto);

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          action: 'GROUP_CREATED',
          entity: 'Group',
          entityId: fakeGroup.id,
        }),
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: fakeGroup.id,
          name: 'My Family',
          memberCount: 1,
          role: 'admin',
        }),
      );
    });

    it('should default type to "family" and currency to "USD" when not provided', async () => {
      let capturedData: Record<string, unknown> | null = null;
      mockPrismaService.$transaction.mockImplementation(async (cb) => {
        const tx = {
          group: {
            create: jest.fn((args) => {
              capturedData = args.data;
              return Promise.resolve({ ...fakeGroup, ...args.data });
            }),
          },
          groupMembership: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.createGroup(userId, { name: 'No Defaults' });

      expect(capturedData).toMatchObject({ type: 'family', defaultCurrency: 'USD' });
    });
  });

  describe('getUserGroups()', () => {
    it('should return groups with member count and role', async () => {
      const memberships = [
        {
          role: 'admin',
          group: {
            id: 'g1',
            name: 'Family A',
            type: 'family',
            defaultCurrency: 'USD',
            createdById: 'user-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { memberships: 3 },
          },
        },
        {
          role: 'member',
          group: {
            id: 'g2',
            name: 'Family B',
            type: 'family',
            defaultCurrency: 'EUR',
            createdById: 'user-2',
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { memberships: 2 },
          },
        },
      ];

      mockPrismaService.groupMembership.findMany.mockResolvedValue(memberships);

      const result = await service.getUserGroups('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({ id: 'g1', role: 'admin', memberCount: 3 }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({ id: 'g2', role: 'member', memberCount: 2 }),
      );
    });

    it('should return empty array when user has no groups', async () => {
      mockPrismaService.groupMembership.findMany.mockResolvedValue([]);

      const result = await service.getUserGroups('user-lonely');

      expect(result).toEqual([]);
    });
  });

  describe('getGroup()', () => {
    it('should return group details with members', async () => {
      const groupRecord = {
        id: 'g1',
        name: 'Family',
        type: 'family',
        defaultCurrency: 'USD',
        createdById: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        memberships: [
          {
            role: 'admin',
            joinedAt: new Date(),
            user: { id: 'user-1', name: 'Alice', email: 'a@test.com' },
          },
          {
            role: 'member',
            joinedAt: new Date(),
            user: { id: 'user-2', name: 'Bob', email: 'b@test.com' },
          },
        ],
      };

      mockPrismaService.group.findUnique.mockResolvedValue(groupRecord);

      const result = await service.getGroup('g1');

      expect(result.id).toBe('g1');
      expect(result.memberCount).toBe(2);
      expect(result.members).toHaveLength(2);
      expect(result.members[0]).toEqual(
        expect.objectContaining({ id: 'user-1', name: 'Alice', role: 'admin' }),
      );
    });

    it('should throw NotFoundException when group does not exist', async () => {
      mockPrismaService.group.findUnique.mockResolvedValue(null);

      await expect(service.getGroup('missing')).rejects.toThrow(NotFoundException);

      try {
        await service.getGroup('missing');
      } catch (error) {
        const response = (error as NotFoundException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({ errorCode: GROUP_ERRORS.GROUP_NOT_FOUND }),
        );
      }
    });
  });

  describe('updateGroup()', () => {
    const existing = {
      id: 'g1',
      name: 'Old',
      type: 'family',
      defaultCurrency: 'USD',
      createdById: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should update name, type, and currency', async () => {
      mockPrismaService.group.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce({
        ...existing,
        name: 'New',
        defaultCurrency: 'EUR',
        memberships: [],
      });
      mockPrismaService.group.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.updateGroup('g1', 'user-1', {
        name: 'New',
        defaultCurrency: 'EUR',
      });

      expect(mockPrismaService.group.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { name: 'New', defaultCurrency: 'EUR' },
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'GROUP_UPDATED',
          entity: 'Group',
          entityId: 'g1',
        }),
      });
      expect(result.name).toBe('New');
    });

    it('should not call update when DTO is empty', async () => {
      mockPrismaService.group.findUnique
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, memberships: [] });

      await service.updateGroup('g1', 'user-1', {});

      expect(mockPrismaService.group.update).not.toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when group does not exist', async () => {
      mockPrismaService.group.findUnique.mockResolvedValue(null);

      await expect(service.updateGroup('missing', 'user-1', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteGroup()', () => {
    const existing = {
      id: 'g1',
      name: 'ToDelete',
      type: 'family',
      defaultCurrency: 'USD',
      createdById: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should delete group and create audit log', async () => {
      mockPrismaService.group.findUnique.mockResolvedValue(existing);
      mockPrismaService.group.delete.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.deleteGroup('g1', 'user-1');

      expect(mockPrismaService.group.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'GROUP_DELETED',
          entity: 'Group',
          entityId: 'g1',
        }),
      });
      expect(result).toEqual({ message: 'Group deleted successfully' });
    });

    it('should throw NotFoundException when group does not exist', async () => {
      mockPrismaService.group.findUnique.mockResolvedValue(null);

      await expect(service.deleteGroup('missing', 'user-1')).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.group.delete).not.toHaveBeenCalled();
    });
  });

  describe('createInvite()', () => {
    it('should create an invite token and audit log, returning raw token and expiry', async () => {
      const groupId = 'g1';
      const userId = 'user-1';

      let capturedData: Record<string, unknown> | undefined;
      mockPrismaService.groupInviteToken.create.mockImplementation((args) => {
        capturedData = args.data;
        return Promise.resolve({ id: 'invite-1', ...args.data });
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.createInvite(groupId, userId);

      expect(result.token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.expiresAt).toBeInstanceOf(Date);
      // Token hash must not equal the raw token
      expect(capturedData).toBeDefined();
      const data = capturedData as {
        tokenHash: string;
        groupId: string;
        createdById: string;
      };
      expect(data.tokenHash).not.toBe(result.token);
      expect(data.tokenHash).toHaveLength(64); // SHA-256 hex
      expect(data.groupId).toBe(groupId);
      expect(data.createdById).toBe(userId);

      // Expiry approximately 7 days ahead
      const diffMs = result.expiresAt.getTime() - Date.now();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          action: 'GROUP_INVITE_CREATED',
          entity: 'GroupInviteToken',
          entityId: 'invite-1',
        }),
      });
    });
  });

  describe('getInviteInfo()', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pastDate = new Date(Date.now() - 60 * 1000);

    it('should return group name, type, and inviter name for a valid token', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue({
        id: 'invite-1',
        createdById: 'user-1',
        expiresAt: futureDate,
        usedAt: null,
        group: { id: 'g1', name: 'Family', type: 'family' },
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ name: 'Alice' });

      const result = await service.getInviteInfo('raw-token');

      expect(result).toEqual({
        groupId: 'g1',
        groupName: 'Family',
        groupType: 'family',
        inviterName: 'Alice',
      });
    });

    it('should throw NotFoundException when token does not exist', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue(null);

      await expect(service.getInviteInfo('missing')).rejects.toThrow(NotFoundException);

      try {
        await service.getInviteInfo('missing');
      } catch (error) {
        const response = (error as NotFoundException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({ errorCode: GROUP_ERRORS.INVITE_TOKEN_INVALID }),
        );
      }
    });

    it('should throw BadRequestException when token is expired', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue({
        id: 'invite-1',
        createdById: 'user-1',
        expiresAt: pastDate,
        usedAt: null,
        group: { id: 'g1', name: 'Family', type: 'family' },
      });

      await expect(service.getInviteInfo('expired')).rejects.toThrow(BadRequestException);

      try {
        await service.getInviteInfo('expired');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({ errorCode: GROUP_ERRORS.INVITE_TOKEN_EXPIRED }),
        );
      }
    });

    it('should throw BadRequestException when token has already been used', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue({
        id: 'invite-1',
        createdById: 'user-1',
        expiresAt: futureDate,
        usedAt: new Date(),
        group: { id: 'g1', name: 'Family', type: 'family' },
      });

      await expect(service.getInviteInfo('used')).rejects.toThrow(BadRequestException);

      try {
        await service.getInviteInfo('used');
      } catch (error) {
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({ errorCode: GROUP_ERRORS.INVITE_TOKEN_USED }),
        );
      }
    });

    it('should fall back to "Unknown" when inviter is missing', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue({
        id: 'invite-1',
        createdById: 'user-1',
        expiresAt: futureDate,
        usedAt: null,
        group: { id: 'g1', name: 'Family', type: 'family' },
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.getInviteInfo('raw-token');

      expect(result.inviterName).toBe('Unknown');
    });
  });

  describe('acceptInvite()', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const userId = 'user-2';
    const validRecord = {
      id: 'invite-1',
      groupId: 'g1',
      createdById: 'user-1',
      expiresAt: futureDate,
      usedAt: null,
    };

    it('should create membership, mark token used, and audit log', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue(validRecord);
      mockPrismaService.groupMembership.findUnique.mockResolvedValue(null);

      const tx = {
        groupInviteToken: { update: jest.fn().mockResolvedValue({}) },
        groupMembership: { create: jest.fn().mockResolvedValue({}) },
      };
      mockPrismaService.$transaction.mockImplementation(async (cb) => cb(tx));
      mockPrismaService.auditLog.create.mockResolvedValue({});
      mockPrismaService.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'Family',
        type: 'family',
        defaultCurrency: 'USD',
        createdById: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { memberships: 2 },
      });

      const result = await service.acceptInvite('raw-token', userId);

      expect(tx.groupInviteToken.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: expect.objectContaining({ usedByUserId: userId }),
      });
      expect(tx.groupMembership.create).toHaveBeenCalledWith({
        data: { groupId: 'g1', userId, role: 'member' },
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          action: 'GROUP_MEMBER_JOINED',
          entity: 'Group',
          entityId: 'g1',
        }),
      });
      expect(result).toEqual(expect.objectContaining({ id: 'g1', role: 'member', memberCount: 2 }));
    });

    it('should throw ConflictException when user is already a member', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue(validRecord);
      mockPrismaService.groupMembership.findUnique.mockResolvedValue({
        id: 'existing-membership',
        groupId: 'g1',
        userId,
        role: 'member',
      });

      await expect(service.acceptInvite('raw-token', userId)).rejects.toThrow(ConflictException);

      try {
        await service.acceptInvite('raw-token', userId);
      } catch (error) {
        const response = (error as ConflictException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({ errorCode: GROUP_ERRORS.ALREADY_A_MEMBER }),
        );
      }

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for an invalid token', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue(null);

      await expect(service.acceptInvite('bad', userId)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for an expired token', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue({
        ...validRecord,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.acceptInvite('expired', userId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for a used token', async () => {
      mockPrismaService.groupInviteToken.findUnique.mockResolvedValue({
        ...validRecord,
        usedAt: new Date(),
      });

      await expect(service.acceptInvite('used', userId)).rejects.toThrow(BadRequestException);
    });
  });
});
