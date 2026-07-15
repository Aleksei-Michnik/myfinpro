import { decodeCursor, encodeCursor, type BudgetPeriod } from '@myfinpro/shared';
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
import { EventBus } from '../realtime/event-bus.service';
import { computeTransactionRecipients } from '../transaction/utils/transaction-event-recipients';
import { BUDGET_ERRORS } from './constants/budget-errors';
import { BudgetListResponseDto } from './dto/budget-list-response.dto';
import { BudgetResponseDto } from './dto/budget-response.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { ListBudgetsQueryDto } from './dto/list-budgets-query.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

/** Compact category embed — same select transactions use in their summaries. */
const CATEGORY_SELECT = {
  select: { id: true, slug: true, name: true, icon: true, color: true },
} as const;

type BudgetWithCategory = Prisma.BudgetGetPayload<{
  include: { category: typeof CATEGORY_SELECT };
}>;

/** Serialize a Budget row (+ category embed) into the API response shape. */
export function mapBudgetToResponse(row: BudgetWithCategory): BudgetResponseDto {
  return {
    id: row.id,
    name: row.name,
    amountCents: row.amountCents,
    currency: row.currency,
    scopeType: row.scopeType as 'personal' | 'group',
    ownerId: row.ownerId,
    groupId: row.groupId,
    categoryId: row.categoryId,
    category: row.category ?? null,
    period: row.period as BudgetPeriod,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    alertThresholdPct: row.alertThresholdPct,
    alertOverspend: row.alertOverspend,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type BudgetAuditAction =
  | 'BUDGET_CREATED'
  | 'BUDGET_UPDATED'
  | 'BUDGET_DELETED'
  | 'BUDGET_ARCHIVED'
  | 'BUDGET_UNARCHIVED';

/**
 * Phase 10 · Iteration 10.2 — Budget CRUD/archive service.
 *
 * Access matrix (design §2.3): personal budgets are managed and read by the
 * owner only; group budgets are mutated by group ADMINs and read by any
 * member. Non-accessors always get 404 (`BUDGET_NOT_FOUND`) — existence is
 * never leaked. The single deliberate 403 (`BUDGET_FORBIDDEN`) is a group
 * member attempting a mutation, because the resource IS visible to them.
 *
 * Progress computation and alert evaluation are NOT here — they ship in
 * iterations 10.5 and 10.9 respectively.
 */
@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async create(userId: string, dto: CreateBudgetDto): Promise<BudgetResponseDto> {
    // 1. Scope — exactly one of ownerId/groupId, mirroring transaction_attributions.
    let ownerId: string | null = null;
    let groupId: string | null = null;
    let groupCurrency: string | null = null;

    if (dto.scopeType === 'personal') {
      if (dto.groupId !== undefined && dto.groupId !== null) {
        throw new BadRequestException({
          message: 'personal budgets must not carry a groupId',
          errorCode: BUDGET_ERRORS.BUDGET_INVALID_SCOPE,
        });
      }
      ownerId = userId;
    } else {
      if (!dto.groupId) {
        throw new BadRequestException({
          message: 'groupId is required when scopeType=group',
          errorCode: BUDGET_ERRORS.BUDGET_INVALID_SCOPE,
        });
      }
      groupCurrency = await this.requireGroupAdminForCreate(userId, dto.groupId);
      groupId = dto.groupId;
    }

    // 2. Period — CUSTOM requires startsAt < endsAt, repeating periods forbid bounds.
    const bounds = this.validatePeriodBounds(dto.period, dto.startsAt ?? null, dto.endsAt ?? null);

    // 3. Category — must exist, be visible in the budget's scope, direction OUT/BOTH.
    if (dto.categoryId) {
      await this.validateCategoryForScope(dto.categoryId, dto.scopeType, ownerId, groupId);
    }

    // 4. Currency — DTO already validated membership in CURRENCY_CODES;
    //    default to the owner's / group's defaultCurrency (design §2.4).
    let currency = dto.currency;
    if (!currency) {
      if (dto.scopeType === 'personal') {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { defaultCurrency: true },
        });
        currency = user?.defaultCurrency ?? 'USD';
      } else {
        currency = groupCurrency ?? 'USD';
      }
    }

    const created = await this.prisma.budget.create({
      data: {
        name: dto.name,
        amountCents: dto.amountCents,
        currency,
        scopeType: dto.scopeType,
        ownerId,
        groupId,
        categoryId: dto.categoryId ?? null,
        period: dto.period,
        startsAt: bounds.startsAt,
        endsAt: bounds.endsAt,
        alertThresholdPct: dto.alertThresholdPct ?? null,
        alertOverspend: dto.alertOverspend ?? true,
        createdById: userId,
      },
      include: { category: CATEGORY_SELECT },
    });

    await this.writeAudit(userId, created.id, 'BUDGET_CREATED', {
      name: created.name,
      amountCents: created.amountCents,
      currency: created.currency,
      scopeType: created.scopeType,
      groupId: created.groupId,
      categoryId: created.categoryId,
      period: created.period,
    });

    this.logger.log(
      `Budget ${created.id} (${created.scopeType}, ${created.period}) created by user ${userId}`,
    );

    await this.publishBudgetUpdated(created, userId);
    return mapBudgetToResponse(created);
  }

  /**
   * List budgets visible to `userId` — personal own + all member groups,
   * narrowed by `scope`, excluding archived unless `includeArchived=true`.
   * Cursor pagination over (createdAt DESC, id DESC).
   */
  async list(userId: string, q: ListBudgetsQueryDto): Promise<BudgetListResponseDto> {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const scopeRaw = q.scope ?? 'all';

    let visibility: Prisma.BudgetWhereInput;
    if (scopeRaw === 'personal') {
      visibility = { scopeType: 'personal', ownerId: userId };
    } else if (scopeRaw.startsWith('group:')) {
      const groupId = scopeRaw.slice('group:'.length);
      const membership = await this.prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { id: true },
      });
      if (!membership) {
        // Same contract as GET /transactions?scope=group:<id> for a non-member.
        throw new ForbiddenException({
          message: 'Requested group scope is not accessible',
          errorCode: BUDGET_ERRORS.BUDGET_FORBIDDEN,
        });
      }
      visibility = { scopeType: 'group', groupId };
    } else {
      visibility = {
        OR: [
          { scopeType: 'personal', ownerId: userId },
          { scopeType: 'group', group: { memberships: { some: { userId } } } },
        ],
      };
    }

    const where: Prisma.BudgetWhereInput = { AND: [visibility] };
    if (q.includeArchived !== 'true') {
      (where.AND as Prisma.BudgetWhereInput[]).push({ archivedAt: null });
    }

    if (q.cursor) {
      let createdAt: Date;
      let id: string;
      try {
        const decoded = decodeCursor(q.cursor);
        createdAt = new Date(decoded.createdAt as string);
        id = decoded.id as string;
        if (Number.isNaN(createdAt.getTime()) || typeof id !== 'string') {
          throw new Error('bad cursor');
        }
      } catch {
        throw new BadRequestException({ message: 'Invalid cursor' });
      }
      (where.AND as Prisma.BudgetWhereInput[]).push({
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
      });
    }

    const rows = await this.prisma.budget.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { category: CATEGORY_SELECT },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map(mapBudgetToResponse),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
      hasMore,
    };
  }

  async findById(userId: string, id: string): Promise<BudgetResponseDto> {
    const budget = await this.loadForRead(userId, id);
    return mapBudgetToResponse(budget);
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto): Promise<BudgetResponseDto> {
    const existing = await this.loadForManage(userId, id);
    this.rejectArchived(existing, 'edit');

    const data: Prisma.BudgetUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.amountCents !== undefined) data.amountCents = dto.amountCents;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.alertThresholdPct !== undefined) data.alertThresholdPct = dto.alertThresholdPct;
    if (dto.alertOverspend !== undefined) data.alertOverspend = dto.alertOverspend;

    // Period — validate against the merged (effective) state so partial
    // patches can't leave a CUSTOM budget without bounds or a repeating
    // one with them. Switching to a repeating period auto-clears bounds.
    if (dto.period !== undefined || dto.startsAt !== undefined || dto.endsAt !== undefined) {
      const period = (dto.period ?? existing.period) as BudgetPeriod;
      const startsAt =
        dto.startsAt !== undefined ? dto.startsAt : (existing.startsAt?.toISOString() ?? null);
      const endsAt =
        dto.endsAt !== undefined ? dto.endsAt : (existing.endsAt?.toISOString() ?? null);
      // Explicit bounds on a repeating period are rejected; inherited stale
      // bounds (period switch away from CUSTOM) are cleared silently.
      const explicitBounds = dto.startsAt != null || dto.endsAt != null;
      if (period !== 'CUSTOM' && explicitBounds) {
        throw new BadRequestException({
          message: `period '${period}' must not carry startsAt/endsAt`,
          errorCode: BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
        });
      }
      const bounds = this.validatePeriodBounds(
        period,
        period === 'CUSTOM' ? startsAt : null,
        period === 'CUSTOM' ? endsAt : null,
      );
      data.period = period;
      data.startsAt = bounds.startsAt;
      data.endsAt = bounds.endsAt;
    }

    if (dto.categoryId !== undefined) {
      if (dto.categoryId === null) {
        data.categoryId = null;
      } else {
        await this.validateCategoryForScope(
          dto.categoryId,
          existing.scopeType as 'personal' | 'group',
          existing.ownerId,
          existing.groupId,
        );
        data.categoryId = dto.categoryId;
      }
    }

    if (Object.keys(data).length === 0) {
      return mapBudgetToResponse(existing);
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data,
      include: { category: CATEGORY_SELECT },
    });

    await this.writeAudit(userId, id, 'BUDGET_UPDATED', {
      changes: data as Record<string, unknown>,
    });
    this.logger.log(`Budget ${id} updated by user ${userId}`);

    await this.publishBudgetUpdated(updated, userId);
    return mapBudgetToResponse(updated);
  }

  /** Hard delete — alert events cascade (design §5). Allowed while archived. */
  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.loadForManage(userId, id);

    await this.prisma.budget.delete({ where: { id } });

    await this.writeAudit(userId, id, 'BUDGET_DELETED', {
      name: existing.name,
      scopeType: existing.scopeType,
      groupId: existing.groupId,
    });
    this.logger.log(`Budget ${id} deleted by user ${userId}`);

    await this.publishBudgetUpdated(existing, userId);
  }

  async archive(userId: string, id: string): Promise<BudgetResponseDto> {
    const existing = await this.loadForManage(userId, id);
    this.rejectArchived(existing, 'archive');

    const updated = await this.prisma.budget.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: { category: CATEGORY_SELECT },
    });

    await this.writeAudit(userId, id, 'BUDGET_ARCHIVED', {});
    this.logger.log(`Budget ${id} archived by user ${userId}`);

    await this.publishBudgetUpdated(updated, userId);
    return mapBudgetToResponse(updated);
  }

  /** Idempotent — unarchiving an active budget is a no-op (no audit/event). */
  async unarchive(userId: string, id: string): Promise<BudgetResponseDto> {
    const existing = await this.loadForManage(userId, id);
    if (!existing.archivedAt) {
      return mapBudgetToResponse(existing);
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: { archivedAt: null },
      include: { category: CATEGORY_SELECT },
    });

    await this.writeAudit(userId, id, 'BUDGET_UNARCHIVED', {});
    this.logger.log(`Budget ${id} unarchived by user ${userId}`);

    await this.publishBudgetUpdated(updated, userId);
    return mapBudgetToResponse(updated);
  }

  // ── access helpers ──

  /**
   * Fetch + read-access check: owner for personal, membership for group.
   * 404 (`BUDGET_NOT_FOUND`) on both "missing" and "not visible" — no
   * existence leak (design §2.3).
   */
  private async loadForRead(userId: string, id: string): Promise<BudgetWithCategory> {
    const budget = await this.prisma.budget.findUnique({
      where: { id },
      include: { category: CATEGORY_SELECT },
    });
    if (budget) {
      if (budget.scopeType === 'personal' && budget.ownerId === userId) return budget;
      if (budget.scopeType === 'group' && budget.groupId) {
        const membership = await this.prisma.groupMembership.findUnique({
          where: { groupId_userId: { groupId: budget.groupId, userId } },
          select: { role: true },
        });
        if (membership) return budget;
      }
    }
    throw new NotFoundException({
      message: 'Budget not found',
      errorCode: BUDGET_ERRORS.BUDGET_NOT_FOUND,
    });
  }

  /**
   * Fetch + mutate-access check. Personal → owner (else the read check 404s).
   * Group → member (else 404) AND admin (else the one deliberate 403,
   * `BUDGET_FORBIDDEN`, because members can see the budget).
   */
  private async loadForManage(userId: string, id: string): Promise<BudgetWithCategory> {
    const budget = await this.loadForRead(userId, id);
    if (budget.scopeType === 'group' && budget.groupId) {
      const membership = await this.prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId: budget.groupId, userId } },
        select: { role: true },
      });
      if (membership?.role !== 'admin') {
        throw new ForbiddenException({
          message: 'Only group admins can manage group budgets',
          errorCode: BUDGET_ERRORS.BUDGET_FORBIDDEN,
        });
      }
    }
    return budget;
  }

  /**
   * Create-time group guard. Non-members get 404 so group ids can't be
   * probed; members without the admin role get 403 `BUDGET_FORBIDDEN`.
   * Returns the group's defaultCurrency for the currency fallback.
   */
  private async requireGroupAdminForCreate(userId: string, groupId: string): Promise<string> {
    const membership = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true, group: { select: { defaultCurrency: true } } },
    });
    if (!membership) {
      throw new NotFoundException({
        message: 'Group not found or not accessible',
        errorCode: BUDGET_ERRORS.BUDGET_INVALID_SCOPE,
      });
    }
    if (membership.role !== 'admin') {
      throw new ForbiddenException({
        message: 'Only group admins can create group budgets',
        errorCode: BUDGET_ERRORS.BUDGET_FORBIDDEN,
      });
    }
    return membership.group.defaultCurrency;
  }

  // ── validation helpers ──

  /**
   * CUSTOM → both bounds required with startsAt < endsAt; every other
   * period forbids explicit bounds (design §5 "Validation rules").
   */
  private validatePeriodBounds(
    period: BudgetPeriod,
    startsAt: string | null,
    endsAt: string | null,
  ): { startsAt: Date | null; endsAt: Date | null } {
    if (period === 'CUSTOM') {
      if (!startsAt || !endsAt) {
        throw new BadRequestException({
          message: 'CUSTOM budgets require both startsAt and endsAt',
          errorCode: BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
        });
      }
      const start = new Date(startsAt);
      const end = new Date(endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
        throw new BadRequestException({
          message: 'CUSTOM budgets require startsAt < endsAt',
          errorCode: BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
        });
      }
      return { startsAt: start, endsAt: end };
    }
    if (startsAt !== null || endsAt !== null) {
      throw new BadRequestException({
        message: `period '${period}' must not carry startsAt/endsAt`,
        errorCode: BUDGET_ERRORS.BUDGET_INVALID_PERIOD,
      });
    }
    return { startsAt: null, endsAt: null };
  }

  /**
   * Category guard (design §5): the category must exist, be visible in the
   * budget's scope — system categories, the owner's personal categories
   * (personal scope) or that group's categories (group scope) — and accept
   * OUT transactions (direction OUT or BOTH). Everything else is a uniform 400
   * `BUDGET_INVALID_CATEGORY` (no existence leak on foreign categories).
   */
  private async validateCategoryForScope(
    categoryId: string,
    scopeType: 'personal' | 'group',
    ownerId: string | null,
    groupId: string | null,
  ): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { ownerType: true, ownerId: true, direction: true },
    });
    const visibleInScope =
      !!category &&
      (category.ownerType === 'system' ||
        (scopeType === 'personal' &&
          category.ownerType === 'user' &&
          category.ownerId === ownerId) ||
        (scopeType === 'group' && category.ownerType === 'group' && category.ownerId === groupId));
    if (!visibleInScope) {
      throw new BadRequestException({
        message: 'Category not found or not visible in the budget scope',
        errorCode: BUDGET_ERRORS.BUDGET_INVALID_CATEGORY,
      });
    }
    if (category.direction !== 'OUT' && category.direction !== 'BOTH') {
      throw new BadRequestException({
        message: 'Budgets track spending — the category direction must be OUT or BOTH',
        errorCode: BUDGET_ERRORS.BUDGET_INVALID_CATEGORY,
      });
    }
  }

  /** Archived budgets reject edit/archive; unarchive and delete stay possible. */
  private rejectArchived(budget: BudgetWithCategory, operation: string): void {
    if (budget.archivedAt) {
      throw new ConflictException({
        message: `Cannot ${operation} an archived budget — unarchive it first`,
        errorCode: BUDGET_ERRORS.BUDGET_ARCHIVED,
      });
    }
  }

  // ── side effects ──

  /**
   * Advisory `budget.updated` SSE on every mutation (design §2.6). The
   * budget's scope maps 1:1 onto the attribution shape the transaction
   * recipient util already understands, so recipients — owner (personal)
   * or all group members (group), plus the acting user — are computed by
   * the same code path transaction events use.
   */
  private async publishBudgetUpdated(budget: BudgetWithCategory, actorId: string): Promise<void> {
    const recipients = await computeTransactionRecipients(
      this.prisma,
      [{ scopeType: budget.scopeType, userId: budget.ownerId, groupId: budget.groupId }],
      actorId,
    );
    this.eventBus.publish({ type: 'budget.updated', userIds: recipients, budgetId: budget.id });
  }

  private async writeAudit(
    userId: string,
    budgetId: string,
    action: BudgetAuditAction,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Budget',
          entityId: budgetId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${budgetId}: ${(err as Error).message}`,
      );
    }
  }
}
