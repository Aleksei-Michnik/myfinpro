import { CURRENCY_CODES, CurrencyCode } from '@myfinpro/shared';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { AttributionDto } from './dto/attribution.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import {
  PaymentAttributionSummary,
  PaymentCategorySummary,
  PaymentSummaryDto,
} from './dto/payment-summary.dto';

/** Sanity cap (~$1 billion in cents); keeps amountCents well inside a 32-bit Int column. */
const MAX_AMOUNT_CENTS = 1e11;

/** Minimal Payment+relations shape we need to produce a summary DTO. */
export type PaymentWithRelations = {
  id: string;
  direction: string;
  type: string;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  status: string;
  note: string | null;
  parentPaymentId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  category: {
    id: string;
    slug: string;
    name: string;
    icon: string | null;
    color: string | null;
  };
  attributions: Array<{
    scopeType: string;
    userId: string | null;
    groupId: string | null;
    group: { name: string } | null;
  }>;
};

/**
 * Map a persisted Payment (with category + attributions + attribution.group loaded)
 * into the wire-level `PaymentSummaryDto`.
 *
 * Exported separately so forthcoming list/get endpoints (6.6 / 6.7) can reuse it
 * without a service rename (per design §5.2).
 */
export function mapPaymentToSummary(
  payment: PaymentWithRelations,
  opts: { starredByMe: boolean; commentCount?: number; hasDocuments?: boolean },
): PaymentSummaryDto {
  const category: PaymentCategorySummary = {
    id: payment.category.id,
    slug: payment.category.slug,
    name: payment.category.name,
    icon: payment.category.icon,
    color: payment.category.color,
  };

  const attributions: PaymentAttributionSummary[] = payment.attributions.map((a) => ({
    scope: a.scopeType as 'personal' | 'group',
    userId: a.userId,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
  }));

  return {
    id: payment.id,
    direction: payment.direction as 'IN' | 'OUT',
    type: payment.type,
    amountCents: payment.amountCents,
    currency: payment.currency,
    occurredAt: payment.occurredAt.toISOString(),
    status: payment.status,
    category,
    attributions,
    note: payment.note,
    commentCount: opts.commentCount ?? 0,
    starredByMe: opts.starredByMe,
    hasDocuments: opts.hasDocuments ?? false,
    parentPaymentId: payment.parentPaymentId,
    createdById: payment.createdById,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryService: CategoryService,
  ) {}

  /**
   * Create a ONE_TIME payment with N attributions in a single transaction.
   *
   * See design §5.2 "Payments" for validation rules and §5.7 for error codes.
   */
  async create(userId: string, dto: CreatePaymentDto): Promise<PaymentSummaryDto> {
    // 1. Type guard — only ONE_TIME is implemented in iteration 6.5.
    if (dto.type !== 'ONE_TIME') {
      throw new BadRequestException({
        message: `Payment type '${dto.type}' is not implemented yet`,
        errorCode: PAYMENT_ERRORS.PAYMENT_TYPE_NOT_IMPLEMENTED,
      });
    }

    // 2. Schedule / plan guards — reserved for iterations 6.17 / 6.19.
    if (dto.schedule !== undefined && dto.schedule !== null) {
      throw new BadRequestException({
        message: 'Schedule bodies are not supported yet',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_SUPPORTED,
      });
    }
    if (dto.plan !== undefined && dto.plan !== null) {
      throw new BadRequestException({
        message: 'Plan bodies are not supported yet',
        errorCode: PAYMENT_ERRORS.PAYMENT_PLAN_NOT_SUPPORTED,
      });
    }

    // 3. Amount sanity cap (DTO already enforces integer > 0).
    if (!Number.isInteger(dto.amountCents) || dto.amountCents <= 0) {
      throw new BadRequestException({
        message: 'amountCents must be a positive integer',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT,
      });
    }
    if (dto.amountCents > MAX_AMOUNT_CENTS) {
      throw new BadRequestException({
        message: 'amountCents exceeds the maximum allowed value',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT,
      });
    }

    // 4. Currency — validated against the shared supported list; free-form is rejected.
    if (!(CURRENCY_CODES as readonly string[]).includes(dto.currency)) {
      throw new BadRequestException({
        message: `Unsupported currency '${dto.currency}'`,
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CURRENCY,
      });
    }

    // 5. Date — reject occurredAt more than 1 day in the future (timezone grace).
    const occurredAt = new Date(dto.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException({
        message: 'occurredAt is not a valid ISO 8601 date',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_DATE,
      });
    }
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (occurredAt.getTime() > Date.now() + oneDayMs) {
      throw new BadRequestException({
        message: 'occurredAt cannot be in the future',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_DATE,
      });
    }

    // 6. Category — reuse CategoryService.findById() for visibility; then check direction.
    let category: Awaited<ReturnType<CategoryService['findById']>>;
    try {
      category = await this.categoryService.findById(userId, dto.categoryId);
    } catch {
      // Any failure (404, forbidden) collapses into PAYMENT_INVALID_CATEGORY for cleaner UX.
      throw new NotFoundException({
        message: 'Category not found or not visible to the user',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CATEGORY,
      });
    }
    if (category.direction !== 'BOTH' && category.direction !== dto.direction) {
      throw new BadRequestException({
        message: `Category direction '${category.direction}' does not accept payments of direction '${dto.direction}'`,
        errorCode: PAYMENT_ERRORS.PAYMENT_CATEGORY_DIRECTION_MISMATCH,
      });
    }

    // 7. Attributions — non-empty, well-formed, de-duplicated, in-scope.
    await this.validateAttributions(userId, dto.attributions);

    // 8. Transaction — Payment + N attributions.
    const created = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          direction: dto.direction,
          type: 'ONE_TIME',
          amountCents: dto.amountCents,
          currency: dto.currency,
          occurredAt,
          status: 'POSTED',
          categoryId: dto.categoryId,
          note: dto.note ?? null,
          createdById: userId,
          attributions: {
            create: dto.attributions.map((a) => ({
              scopeType: a.scope,
              userId: a.scope === 'personal' ? userId : null,
              groupId: a.scope === 'group' ? (a.groupId ?? null) : null,
            })),
          },
        },
        include: {
          category: {
            select: { id: true, slug: true, name: true, icon: true, color: true },
          },
          attributions: {
            include: { group: { select: { name: true } } },
          },
        },
      });
      return payment;
    });

    // 9. Audit — fire-and-forget.
    void this.writeAudit(userId, created.id, {
      direction: dto.direction,
      type: 'ONE_TIME',
      amountCents: dto.amountCents,
      currency: dto.currency,
      categoryId: dto.categoryId,
      attributions: dto.attributions,
    });

    this.logger.log(`Payment ${created.id} (ONE_TIME, ${dto.direction}) created by user ${userId}`);

    // 10. Serialize.
    return mapPaymentToSummary(created as PaymentWithRelations, { starredByMe: false });
  }

  // ── helpers ──

  private async validateAttributions(
    userId: string,
    attributions: AttributionDto[],
  ): Promise<void> {
    if (!attributions || attributions.length === 0) {
      throw new BadRequestException({
        message: 'At least one attribution is required',
        errorCode: PAYMENT_ERRORS.PAYMENT_NO_ATTRIBUTIONS,
      });
    }

    const seen = new Set<string>();
    const groupIdsToCheck = new Set<string>();

    for (const a of attributions) {
      if (a.scope === 'personal') {
        if (a.groupId !== undefined && a.groupId !== null) {
          throw new BadRequestException({
            message: 'personal attributions must not carry a groupId',
            errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_ATTRIBUTION,
          });
        }
      } else if (a.scope === 'group') {
        if (!a.groupId) {
          throw new BadRequestException({
            message: 'group attributions require a groupId',
            errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_ATTRIBUTION,
          });
        }
        groupIdsToCheck.add(a.groupId);
      } else {
        throw new BadRequestException({
          message: `Unknown attribution scope '${(a as { scope: string }).scope}'`,
          errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_ATTRIBUTION,
        });
      }

      const key = `${a.scope}|${a.groupId ?? ''}`;
      if (seen.has(key)) {
        throw new BadRequestException({
          message: 'Duplicate attributions are not allowed',
          errorCode: PAYMENT_ERRORS.PAYMENT_DUPLICATE_ATTRIBUTION,
        });
      }
      seen.add(key);
    }

    if (groupIdsToCheck.size > 0) {
      const memberships = await this.prisma.groupMembership.findMany({
        where: { userId, groupId: { in: Array.from(groupIdsToCheck) } },
        select: { groupId: true },
      });
      const memberGroupIds = new Set(memberships.map((m) => m.groupId));
      for (const gid of groupIdsToCheck) {
        if (!memberGroupIds.has(gid)) {
          throw new ForbiddenException({
            message: `User is not a member of group ${gid}`,
            errorCode: PAYMENT_ERRORS.PAYMENT_ATTRIBUTION_OUT_OF_SCOPE,
          });
        }
      }
    }
  }

  private async writeAudit(
    userId: string,
    paymentId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'PAYMENT_CREATED',
          entity: 'Payment',
          entityId: paymentId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for PAYMENT_CREATED ${paymentId}: ${(err as Error).message}`,
      );
    }
  }
}

/** Re-export for symmetry with other services that keep currency types local. */
export type { CurrencyCode };
