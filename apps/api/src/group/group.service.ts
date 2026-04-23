import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
}
