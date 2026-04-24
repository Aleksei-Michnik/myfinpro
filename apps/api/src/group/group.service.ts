import * as crypto from 'crypto';
import { INVITE_TOKEN_EXPIRY_DAYS } from '@myfinpro/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GROUP_ERRORS } from './constants/group-errors';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

export interface GroupSummary {
  id: string;
  name: string;
  type: string;
  defaultCurrency: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  role?: string;
}

export interface GroupMember {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: Date;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMember[];
}

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new group and add the creator as an admin member in a single transaction.
   */
  async createGroup(userId: string, dto: CreateGroupDto): Promise<GroupSummary> {
    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.group.create({
        data: {
          name: dto.name,
          type: dto.type || 'family',
          defaultCurrency: dto.defaultCurrency || 'USD',
          createdById: userId,
        },
      });

      await tx.groupMembership.create({
        data: {
          groupId: created.id,
          userId,
          role: 'admin',
        },
      });

      return created;
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'GROUP_CREATED',
        entity: 'Group',
        entityId: group.id,
        details: { name: group.name, type: group.type },
      },
    });

    this.logger.log(`Group created: ${group.name} (${group.id}) by user ${userId}`);

    return {
      id: group.id,
      name: group.name,
      type: group.type,
      defaultCurrency: group.defaultCurrency,
      createdById: group.createdById,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      memberCount: 1,
      role: 'admin',
    };
  }

  /**
   * List all groups the user belongs to, including the user's role and member count.
   */
  async getUserGroups(userId: string): Promise<GroupSummary[]> {
    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            _count: { select: { memberships: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      type: m.group.type,
      defaultCurrency: m.group.defaultCurrency,
      createdById: m.group.createdById,
      createdAt: m.group.createdAt,
      updatedAt: m.group.updatedAt,
      memberCount: m.group._count.memberships,
      role: m.role,
    }));
  }

  /**
   * Get full group details including member list. Throws `NotFoundException` if missing.
   */
  async getGroup(groupId: string): Promise<GroupDetail> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        memberships: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!group) {
      throw new NotFoundException({
        message: 'Group not found',
        errorCode: GROUP_ERRORS.GROUP_NOT_FOUND,
      });
    }

    const members: GroupMember[] = group.memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt,
    }));

    return {
      id: group.id,
      name: group.name,
      type: group.type,
      defaultCurrency: group.defaultCurrency,
      createdById: group.createdById,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      memberCount: members.length,
      members,
    };
  }

  /**
   * Update mutable group fields. Only provided fields are changed.
   */
  async updateGroup(groupId: string, userId: string, dto: UpdateGroupDto): Promise<GroupDetail> {
    const existing = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Group not found',
        errorCode: GROUP_ERRORS.GROUP_NOT_FOUND,
      });
    }

    const data: Record<string, string> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.defaultCurrency !== undefined) data.defaultCurrency = dto.defaultCurrency;

    if (Object.keys(data).length > 0) {
      await this.prisma.group.update({
        where: { id: groupId },
        data,
      });

      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'GROUP_UPDATED',
          entity: 'Group',
          entityId: groupId,
          details: { changes: data },
        },
      });

      this.logger.log(`Group updated: ${groupId} by user ${userId}`);
    }

    return this.getGroup(groupId);
  }

  /**
   * Delete a group (and cascade memberships/invite tokens) and record audit log.
   */
  async deleteGroup(groupId: string, userId: string): Promise<{ message: string }> {
    const existing = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Group not found',
        errorCode: GROUP_ERRORS.GROUP_NOT_FOUND,
      });
    }

    await this.prisma.group.delete({ where: { id: groupId } });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'GROUP_DELETED',
        entity: 'Group',
        entityId: groupId,
        details: { name: existing.name, type: existing.type },
      },
    });

    this.logger.log(`Group deleted: ${existing.name} (${groupId}) by user ${userId}`);

    return { message: 'Group deleted successfully' };
  }

  /**
   * Generate an invite token for a group. Raw UUID token is returned to the
   * caller; only the SHA-256 hash is persisted.
   */
  async createInvite(groupId: string, userId: string): Promise<{ token: string; expiresAt: Date }> {
    const rawToken = crypto.randomUUID();
    const tokenHash = this.hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_TOKEN_EXPIRY_DAYS);

    const record = await this.prisma.groupInviteToken.create({
      data: {
        tokenHash,
        groupId,
        createdById: userId,
        expiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'GROUP_INVITE_CREATED',
        entity: 'GroupInviteToken',
        entityId: record.id,
        details: { groupId },
      },
    });

    this.logger.log(`Group invite created for group ${groupId} by user ${userId}`);

    return { token: rawToken, expiresAt };
  }

  /**
   * Get invite info for the accept page. Validates that the token exists,
   * is not expired, and not yet used. Returns group and inviter summary.
   */
  async getInviteInfo(rawToken: string): Promise<{
    groupId: string;
    groupName: string;
    groupType: string;
    inviterName: string;
  }> {
    const tokenHash = this.hashToken(rawToken);

    const record = await this.prisma.groupInviteToken.findUnique({
      where: { tokenHash },
      include: {
        group: { select: { id: true, name: true, type: true } },
      },
    });

    this.ensureInviteUsable(record);

    const inviter = await this.prisma.user.findUnique({
      where: { id: record!.createdById },
      select: { name: true },
    });

    return {
      groupId: record!.group.id,
      groupName: record!.group.name,
      groupType: record!.group.type,
      inviterName: inviter?.name ?? 'Unknown',
    };
  }

  /**
   * Accept an invite token: validate, ensure the user isn't already a member,
   * then in a transaction mark the token used and create the membership.
   */
  async acceptInvite(rawToken: string, userId: string): Promise<GroupSummary> {
    const tokenHash = this.hashToken(rawToken);

    const record = await this.prisma.groupInviteToken.findUnique({
      where: { tokenHash },
    });

    this.ensureInviteUsable(record);

    const groupId = record!.groupId;

    const existingMembership = await this.prisma.groupMembership.findUnique({
      where: {
        groupId_userId: { groupId, userId },
      },
    });

    if (existingMembership) {
      throw new ConflictException({
        message: 'You are already a member of this group',
        errorCode: GROUP_ERRORS.ALREADY_A_MEMBER,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.groupInviteToken.update({
        where: { id: record!.id },
        data: { usedAt: new Date(), usedByUserId: userId },
      });

      await tx.groupMembership.create({
        data: {
          groupId,
          userId,
          role: 'member',
        },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'GROUP_MEMBER_JOINED',
        entity: 'Group',
        entityId: groupId,
        details: { inviteTokenId: record!.id },
      },
    });

    this.logger.log(`User ${userId} joined group ${groupId} via invite ${record!.id}`);

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { _count: { select: { memberships: true } } },
    });

    if (!group) {
      throw new NotFoundException({
        message: 'Group not found',
        errorCode: GROUP_ERRORS.GROUP_NOT_FOUND,
      });
    }

    return {
      id: group.id,
      name: group.name,
      type: group.type,
      defaultCurrency: group.defaultCurrency,
      createdById: group.createdById,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      memberCount: group._count.memberships,
      role: 'member',
    };
  }

  /**
   * Update a member's role within a group. Enforces that the last admin
   * cannot be demoted to a member.
   */
  async updateMemberRole(
    groupId: string,
    targetUserId: string,
    actorUserId: string,
    newRole: string,
  ): Promise<{ groupId: string; userId: string; role: string; joinedAt: Date }> {
    const membership = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    if (!membership) {
      throw new NotFoundException({
        message: 'User is not a member of this group',
        errorCode: GROUP_ERRORS.NOT_A_MEMBER,
      });
    }

    const oldRole = membership.role;

    // If demoting an admin, ensure at least one other admin remains.
    if (oldRole === 'admin' && newRole !== 'admin') {
      const adminCount = await this.prisma.groupMembership.count({
        where: { groupId, role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new ConflictException({
          message: 'Cannot remove the last admin of the group',
          errorCode: GROUP_ERRORS.CANNOT_REMOVE_LAST_ADMIN,
        });
      }
    }

    const updated = await this.prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { role: newRole },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'group.member.role_changed',
        entity: 'GroupMembership',
        entityId: groupId,
        details: { targetUserId, oldRole, newRole },
      },
    });

    this.logger.log(
      `Group ${groupId} member ${targetUserId} role changed ${oldRole} -> ${newRole} by ${actorUserId}`,
    );

    return {
      groupId: updated.groupId,
      userId: updated.userId,
      role: updated.role,
      joinedAt: updated.joinedAt,
    };
  }

  /**
   * Remove a member from a group. Enforces that a user cannot remove
   * themselves via this endpoint and that the last admin cannot be removed.
   */
  async removeMember(groupId: string, targetUserId: string, actorUserId: string): Promise<void> {
    if (targetUserId === actorUserId) {
      throw new BadRequestException({
        message: 'You cannot remove yourself from a group — use the leave endpoint instead',
        errorCode: GROUP_ERRORS.CANNOT_REMOVE_SELF,
      });
    }

    const membership = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    if (!membership) {
      throw new NotFoundException({
        message: 'User is not a member of this group',
        errorCode: GROUP_ERRORS.NOT_A_MEMBER,
      });
    }

    if (membership.role === 'admin') {
      const adminCount = await this.prisma.groupMembership.count({
        where: { groupId, role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new ConflictException({
          message: 'Cannot remove the last admin of the group',
          errorCode: GROUP_ERRORS.CANNOT_REMOVE_LAST_ADMIN,
        });
      }
    }

    await this.prisma.groupMembership.delete({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'group.member.removed',
        entity: 'GroupMembership',
        entityId: groupId,
        details: { targetUserId },
      },
    });

    this.logger.log(`Group ${groupId} member ${targetUserId} removed by ${actorUserId}`);
  }

  /**
   * Leave a group (remove the authenticated user's own membership).
   *
   * Rules:
   * - If the user is the last admin and there are other members → throw 409.
   * - If the user is the last admin AND the only member → delete the group
   *   entirely (last person out deletes).
   * - Otherwise → simply remove the membership.
   */
  async leaveGroup(groupId: string, userId: string): Promise<{ groupDeleted: boolean }> {
    const membership = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!membership) {
      // Guard should prevent this, but fail safely if it somehow gets through.
      throw new NotFoundException({
        message: 'You are not a member of this group',
        errorCode: GROUP_ERRORS.NOT_A_MEMBER,
      });
    }

    const totalMembers = await this.prisma.groupMembership.count({ where: { groupId } });

    // Admin-specific checks
    if (membership.role === 'admin') {
      const adminCount = await this.prisma.groupMembership.count({
        where: { groupId, role: 'admin' },
      });

      // Last admin, but other (non-admin) members exist → block.
      if (adminCount <= 1 && totalMembers > 1) {
        throw new ConflictException({
          message:
            'You are the last admin — promote another member to admin before leaving the group',
          errorCode: GROUP_ERRORS.CANNOT_LEAVE_AS_LAST_ADMIN,
        });
      }

      // Last admin AND only member → delete the group.
      if (adminCount <= 1 && totalMembers <= 1) {
        await this.prisma.group.delete({ where: { id: groupId } });

        try {
          await this.prisma.auditLog.create({
            data: {
              userId,
              action: 'group.member.left',
              entity: 'Group',
              entityId: groupId,
              details: { userId, wasLastAdmin: true },
            },
          });
          await this.prisma.auditLog.create({
            data: {
              userId,
              action: 'group.deleted_on_leave',
              entity: 'Group',
              entityId: groupId,
              details: { userId },
            },
          });
        } catch (err) {
          this.logger.warn(
            `Failed to write audit log for leaveGroup (delete) ${groupId} by ${userId}: ${(err as Error).message}`,
          );
        }

        this.logger.log(`Group ${groupId} deleted on leave by user ${userId} (last member out)`);

        return { groupDeleted: true };
      }
    }

    // Normal case: remove the membership.
    await this.prisma.groupMembership.delete({
      where: { groupId_userId: { groupId, userId } },
    });

    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'group.member.left',
          entity: 'Group',
          entityId: groupId,
          details: { userId, wasLastAdmin: false },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for leaveGroup ${groupId} by ${userId}: ${(err as Error).message}`,
      );
    }

    this.logger.log(`User ${userId} left group ${groupId}`);

    return { groupDeleted: false };
  }

  /**
   * Validate that an invite token record exists, is not used, and not expired.
   * Throws the appropriate error otherwise.
   */
  private ensureInviteUsable(record: { usedAt: Date | null; expiresAt: Date } | null): void {
    if (!record) {
      throw new NotFoundException({
        message: 'Invalid invite token',
        errorCode: GROUP_ERRORS.INVITE_TOKEN_INVALID,
      });
    }

    if (record.usedAt) {
      throw new BadRequestException({
        message: 'Invite token has already been used',
        errorCode: GROUP_ERRORS.INVITE_TOKEN_USED,
      });
    }

    if (record.expiresAt < new Date()) {
      throw new BadRequestException({
        message: 'Invite token has expired',
        errorCode: GROUP_ERRORS.INVITE_TOKEN_EXPIRED,
      });
    }
  }

  /**
   * SHA-256 hash of a raw token string.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
