import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CATEGORY_ERRORS } from './constants/category-errors';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { DeleteCategoryQueryDto } from './dto/delete-category-query.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  direction: string;
  ownerType: string;
  ownerId: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListCategoriesQueryDto): Promise<CategoryResponseDto[]> {
    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId },
      select: { groupId: true, role: true },
    });
    const memberGroupIds = memberships.map((m) => m.groupId);

    const scope = query.scope ?? 'all';
    const visibility: Prisma.CategoryWhereInput[] = [];

    if (scope === 'all') {
      visibility.push({ ownerType: 'system' });
      visibility.push({ ownerType: 'user', ownerId: userId });
      if (memberGroupIds.length > 0) {
        visibility.push({ ownerType: 'group', ownerId: { in: memberGroupIds } });
      }
    } else if (scope === 'system') {
      visibility.push({ ownerType: 'system' });
    } else if (scope === 'personal') {
      visibility.push({ ownerType: 'user', ownerId: userId });
    } else if (scope.startsWith('group:')) {
      const groupId = scope.slice('group:'.length);
      if (!memberGroupIds.includes(groupId)) {
        throw new ForbiddenException({
          message: 'You are not a member of this group',
          errorCode: CATEGORY_ERRORS.CATEGORY_GROUP_NOT_MEMBER,
        });
      }
      visibility.push({ ownerType: 'group', ownerId: groupId });
    } else {
      throw new BadRequestException({
        message: 'Invalid scope',
        errorCode: CATEGORY_ERRORS.CATEGORY_INVALID_SCOPE,
      });
    }

    const where: Prisma.CategoryWhereInput = { OR: visibility };
    if (query.direction) {
      where.direction = { in: [query.direction, 'BOTH'] };
    }

    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ ownerType: 'asc' }, { name: 'asc' }],
    });

    return rows.map((r) => this.toDto(r));
  }

  async findById(userId: string, id: string): Promise<CategoryResponseDto> {
    const row = await this.prisma.category.findUnique({ where: { id } });
    if (!row || !(await this.isVisibleTo(row, userId))) {
      throw new NotFoundException({
        message: 'Category not found',
        errorCode: CATEGORY_ERRORS.CATEGORY_NOT_FOUND,
      });
    }
    return this.toDto(row);
  }

  async create(userId: string, dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    let ownerType: 'user' | 'group';
    let ownerId: string;

    if (dto.scope === 'personal') {
      ownerType = 'user';
      ownerId = userId;
    } else if (dto.scope === 'group') {
      if (!dto.groupId) {
        throw new BadRequestException({
          message: 'groupId is required when scope=group',
          errorCode: CATEGORY_ERRORS.CATEGORY_INVALID_SCOPE,
        });
      }
      await this.requireGroupAdmin(userId, dto.groupId);
      ownerType = 'group';
      ownerId = dto.groupId;
    } else {
      throw new BadRequestException({
        message: 'Invalid scope',
        errorCode: CATEGORY_ERRORS.CATEGORY_INVALID_SCOPE,
      });
    }

    const slug = dto.slug ?? CategoryService.generateSlug(dto.name);

    try {
      const created = await this.prisma.category.create({
        data: {
          slug,
          name: dto.name,
          icon: dto.icon ?? null,
          color: dto.color ?? null,
          direction: dto.direction,
          ownerType,
          ownerId,
          isSystem: false,
        },
      });

      await this.writeAudit(userId, 'CATEGORY_CREATED', created.id, {
        slug: created.slug,
        direction: created.direction,
        ownerType,
        ownerId,
      });

      this.logger.log(`Category ${created.id} (${slug}) created by user ${userId}`);
      return this.toDto(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          message: 'A category with this slug already exists for this owner and direction',
          errorCode: CATEGORY_ERRORS.CATEGORY_SLUG_CONFLICT,
        });
      }
      throw err;
    }
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto): Promise<CategoryResponseDto> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Category not found',
        errorCode: CATEGORY_ERRORS.CATEGORY_NOT_FOUND,
      });
    }
    await this.requireOwner(existing, userId);

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.color !== undefined) data.color = dto.color;

    if (dto.direction !== undefined && dto.direction !== existing.direction) {
      const usage = await this.prisma.payment.count({ where: { categoryId: id } });
      if (usage > 0) {
        throw new ConflictException({
          message: 'Cannot change direction of a category that is in use',
          errorCode: CATEGORY_ERRORS.CATEGORY_IN_USE,
          details: { usage },
        });
      }
      data.direction = dto.direction;
    }

    if (Object.keys(data).length === 0) {
      return this.toDto(existing);
    }

    try {
      const updated = await this.prisma.category.update({ where: { id }, data });
      await this.writeAudit(userId, 'CATEGORY_UPDATED', id, {
        changes: data as Record<string, unknown>,
      });
      this.logger.log(`Category ${id} updated by user ${userId}`);
      return this.toDto(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          message: 'A category with this slug already exists for this owner and direction',
          errorCode: CATEGORY_ERRORS.CATEGORY_SLUG_CONFLICT,
        });
      }
      throw err;
    }
  }

  async remove(
    userId: string,
    id: string,
    q: DeleteCategoryQueryDto,
  ): Promise<{ deleted: true; reassigned: number }> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Category not found',
        errorCode: CATEGORY_ERRORS.CATEGORY_NOT_FOUND,
      });
    }
    await this.requireOwner(existing, userId);

    const usage = await this.prisma.payment.count({ where: { categoryId: id } });

    if (usage === 0) {
      await this.prisma.category.delete({ where: { id } });
      await this.writeAudit(userId, 'CATEGORY_DELETED', id, {
        slug: existing.slug,
        usage: 0,
      });
      this.logger.log(`Category ${id} deleted by user ${userId} (no payments)`);
      return { deleted: true, reassigned: 0 };
    }

    if (!q.replaceWithCategoryId) {
      throw new ConflictException({
        message: 'Category is in use; provide replaceWithCategoryId to reassign payments',
        errorCode: CATEGORY_ERRORS.CATEGORY_IN_USE,
        details: { usage },
      });
    }

    if (q.replaceWithCategoryId === id) {
      throw new BadRequestException({
        message: 'Replacement cannot be the same category',
        errorCode: CATEGORY_ERRORS.CATEGORY_REPLACEMENT_INVALID,
      });
    }

    const replacement = await this.prisma.category.findUnique({
      where: { id: q.replaceWithCategoryId },
    });
    if (!replacement || !(await this.isVisibleTo(replacement, userId))) {
      throw new NotFoundException({
        message: 'Replacement category not found',
        errorCode: CATEGORY_ERRORS.CATEGORY_NOT_FOUND,
      });
    }

    const sourceDir = existing.direction;
    const targetDir = replacement.direction;
    if (targetDir !== sourceDir && targetDir !== 'BOTH') {
      throw new ConflictException({
        message: 'Replacement category direction is incompatible',
        errorCode: CATEGORY_ERRORS.CATEGORY_REPLACEMENT_INVALID,
        details: { sourceDir, targetDir },
      });
    }

    const reassigned = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.payment.updateMany({
        where: { categoryId: id },
        data: { categoryId: q.replaceWithCategoryId! },
      });
      await tx.category.delete({ where: { id } });
      return upd.count;
    });

    await this.writeAudit(userId, 'CATEGORY_REASSIGNED', id, {
      slug: existing.slug,
      replacementId: q.replaceWithCategoryId,
      reassigned,
    });
    await this.writeAudit(userId, 'CATEGORY_DELETED', id, {
      slug: existing.slug,
      usage,
      reassigned,
    });

    this.logger.log(
      `Category ${id} deleted by user ${userId} after reassigning ${reassigned} payments`,
    );
    return { deleted: true, reassigned };
  }

  // ── helpers ──

  private async isVisibleTo(row: CategoryRow, userId: string): Promise<boolean> {
    if (row.ownerType === 'system') return true;
    if (row.ownerType === 'user' && row.ownerId === userId) return true;
    if (row.ownerType === 'group' && row.ownerId) {
      const m = await this.prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId: row.ownerId, userId } },
        select: { id: true },
      });
      return !!m;
    }
    return false;
  }

  private async requireOwner(row: CategoryRow, userId: string): Promise<void> {
    if (row.isSystem || row.ownerType === 'system') {
      throw new ForbiddenException({
        message: 'System categories are immutable',
        errorCode: CATEGORY_ERRORS.CATEGORY_SYSTEM_IMMUTABLE,
      });
    }
    if (row.ownerType === 'user') {
      if (row.ownerId !== userId) {
        throw new ForbiddenException({
          message: 'You are not the owner of this category',
          errorCode: CATEGORY_ERRORS.CATEGORY_NOT_OWNER,
        });
      }
      return;
    }
    if (row.ownerType === 'group' && row.ownerId) {
      await this.requireGroupAdmin(userId, row.ownerId);
      return;
    }
    throw new ForbiddenException({
      message: 'You are not the owner of this category',
      errorCode: CATEGORY_ERRORS.CATEGORY_NOT_OWNER,
    });
  }

  private async requireGroupAdmin(userId: string, groupId: string): Promise<void> {
    const m = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!m) {
      throw new ForbiddenException({
        message: 'You are not a member of this group',
        errorCode: CATEGORY_ERRORS.CATEGORY_GROUP_NOT_MEMBER,
      });
    }
    if (m.role !== 'admin') {
      throw new ForbiddenException({
        message: 'Only group admins can manage group categories',
        errorCode: CATEGORY_ERRORS.CATEGORY_GROUP_NOT_ADMIN,
      });
    }
  }

  private async writeAudit(
    userId: string,
    action: 'CATEGORY_CREATED' | 'CATEGORY_UPDATED' | 'CATEGORY_DELETED' | 'CATEGORY_REASSIGNED',
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Category',
          entityId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${entityId}: ${(err as Error).message}`,
      );
    }
  }

  private toDto(row: CategoryRow): CategoryResponseDto {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      color: row.color,
      direction: row.direction as 'IN' | 'OUT' | 'BOTH',
      ownerType: row.ownerType as 'system' | 'user' | 'group',
      ownerId: row.ownerId,
      isSystem: row.isSystem,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Generate a stable slug from a display name:
   *   lowercase → non-`[a-z0-9]+` chunks collapsed to `_` → trimmed → max 64 chars.
   */
  private static generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    return base.length > 0 ? base : 'category';
  }
}
