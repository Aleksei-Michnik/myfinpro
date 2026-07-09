import { CURRENCY_CODES, CurrencyCode, isPlanKind, PAYMENT_PLAN_KINDS } from '@myfinpro/shared';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { CategoryService } from '../category/category.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { PAYMENT_ERRORS } from './constants/payment-errors';
import { AttributionChangeResultDto } from './dto/attribution-change-result.dto';
import { AttributionDto } from './dto/attribution.dto';
import { CascadeEditResponseDto } from './dto/cascade-edit-response.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { DeletePaymentQueryDto } from './dto/delete-payment.query.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { PaymentListResponseDto } from './dto/payment-list-response.dto';
import {
  PaymentAttributionSummary,
  PaymentCategorySummary,
  PaymentSummaryDto,
} from './dto/payment-summary.dto';
import { ToggleStarResponseDto } from './dto/toggle-star-response.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentPropagateMode } from './dto/update-payment.query.dto';
import { createPlanWithinTransaction, validatePlanAndCompute } from './payment-plan.create';
import {
  computePaymentRecipients,
  type RecipientAttribution,
} from './utils/payment-event-recipients';
import { removeScheduleForPayment } from './utils/schedule-cascade';

/** Sanity cap (~$1 billion in cents); keeps amountCents well inside a 32-bit Int column. */
const MAX_AMOUNT_CENTS = 1e11;

/**
 * Payment types that the create flow accepts today.
 *
 * - `ONE_TIME` — shipped in iteration 6.5.
 * - `RECURRING` — shipped in iteration 6.18.1.1; the schedule sub-resource
 *   (POST /payments/:id/schedule) is created in a separate request.
 *
 * Other `PaymentType` enum values (`LIMITED_PERIOD`, `INSTALLMENT`, `LOAN`,
 * `MORTGAGE`) are intentionally absent: their behaviour is deferred to phase
 * 7+ per the design doc, and the create endpoint surfaces that with the
 * structured `PAYMENT_TYPE_NOT_IMPLEMENTED` error code.
 */
export const SUPPORTED_CREATE_TYPES = ['ONE_TIME', 'RECURRING'] as const;
export type SupportedCreateType = (typeof SUPPORTED_CREATE_TYPES)[number];

/**
 * Single source of truth for the relation load used by list(), findByIdForUser(),
 * and update(). Keeps mapping code honest — every path feeds the same shape into
 * `mapPaymentToSummary()`, so rendering diffs can only come from row values, not
 * include drift.
 */
export const PAYMENT_DETAIL_INCLUDE = {
  category: {
    select: { id: true, slug: true, name: true, icon: true, color: true },
  },
  attributions: { include: { group: { select: { name: true } } } },
  stars: { select: { id: true }, where: {} as { userId?: string } },
  _count: { select: { comments: true, documents: true } },
} as const;

/** Build the include with the `stars.where.userId` set to the viewer. */
function buildDetailInclude(userId: string) {
  return {
    category: PAYMENT_DETAIL_INCLUDE.category,
    attributions: PAYMENT_DETAIL_INCLUDE.attributions,
    stars: { where: { userId }, select: { id: true } },
    _count: PAYMENT_DETAIL_INCLUDE._count,
  } satisfies Prisma.PaymentInclude;
}

/** One row shape we need from `paymentAttribution` when running the
 *  iteration 6.8 scope resolver. Matches the raw Prisma row without the
 *  `group` relation (we only need `id/scopeType/userId/groupId` to make
 *  the accessibility + diff decisions). */
export type AttributionRow = {
  id: string;
  scopeType: string;
  userId: string | null;
  groupId: string | null;
};

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
 * into the wire-level `PaymentSummaryDto`. Shared by create / list / get / update.
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
    @InjectQueue(PAYMENT_OCCURRENCES_QUEUE) private readonly queue: Queue,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Visibility predicate (design §5.2): a payment is visible to `userId` iff at
   * least one of its attributions is personal to them OR targets a group they
   * are a member of. Shared between list() (scope=all), findByIdForUser(), and
   * update() — one source of truth for access logic.
   */
  private buildVisibilityWhere(userId: string): Prisma.PaymentWhereInput {
    return {
      attributions: {
        some: {
          OR: [
            { scopeType: 'personal', userId },
            {
              scopeType: 'group',
              group: { memberships: { some: { userId } } },
            },
          ],
        },
      },
    };
  }

  /**
   * Public, lightweight visibility guard — cross-service helper.
   *
   * Throws `NotFoundException` with `PAYMENT_NOT_FOUND` when `paymentId` does
   * not exist OR when the caller has no qualifying attribution. Intended for
   * sibling services (e.g. `PaymentCommentService`) that need to enforce
   * "any user with payment access" without duplicating the predicate. The
   * existing in-service call sites (`findByIdForUser`, `update`, `remove`,
   * `toggleStar`) keep their inline fetch+check to avoid touching battle-
   * tested code paths; see progress iteration 6.10 for the refactor-scope
   * decision.
   */
  async assertVisible(userId: string, paymentId: string): Promise<void> {
    const visible = await this.prisma.payment.findFirst({
      where: { AND: [{ id: paymentId }, this.buildVisibilityWhere(userId)] },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }
  }

  /**
   * Create a ONE_TIME or RECURRING payment with N attributions in a single transaction.
   *
   * Iteration 6.5 introduced the endpoint behind a strict ONE_TIME-only guard;
   * iteration 6.18.1.1 lifts the guard to also accept RECURRING because the
   * recurring infrastructure (schedule CRUD, worker, cascade) shipped fully in
   * 6.17.1–6.17.4 and the web client (6.18.1) needs the parent row before it
   * can POST the schedule sub-resource. The remaining types (LIMITED_PERIOD,
   * INSTALLMENT, LOAN, MORTGAGE) keep returning PAYMENT_TYPE_NOT_IMPLEMENTED;
   * they are scheduled for phase 7+.
   *
   * Note on RECURRING: this method only inserts the parent row — it does NOT
   * auto-create a `PaymentSchedule`. The web client follows up with a second
   * POST to `/payments/:id/schedule` (the two-step create from 6.18.1), and
   * the server keeps that resource separate so the schedule lifecycle stays
   * orthogonal to the payment lifecycle.
   *
   * See design §5.2 "Payments" for validation rules and §5.7 for error codes.
   */
  async create(userId: string, dto: CreatePaymentDto): Promise<PaymentSummaryDto> {
    // 1. Type guard — ONE_TIME (6.5), RECURRING (6.18.1.1), and the plan
    //    kinds INSTALLMENT / LOAN / MORTGAGE (6.19) are implemented.
    //    LIMITED_PERIOD remains deferred.
    const isPlan = isPlanKind(dto.type);
    if (!(SUPPORTED_CREATE_TYPES as readonly string[]).includes(dto.type) && !isPlan) {
      throw new BadRequestException({
        message: `Payment type '${dto.type}' is not implemented yet`,
        errorCode: PAYMENT_ERRORS.PAYMENT_TYPE_NOT_IMPLEMENTED,
      });
    }

    // 2. Schedule guard — reserved (schedules are a separate sub-resource,
    //    posted by the client after the parent exists — see 6.18.1).
    if (dto.schedule !== undefined && dto.schedule !== null) {
      throw new BadRequestException({
        message: 'Schedule bodies are not supported yet',
        errorCode: PAYMENT_ERRORS.PAYMENT_SCHEDULE_NOT_SUPPORTED,
      });
    }
    // 2b. Plan body — required for plan kinds (a plan parent without its
    //     occurrence rows would be a broken invariant), rejected otherwise.
    if (isPlan && (dto.plan === undefined || dto.plan === null)) {
      throw new BadRequestException({
        message: `Payment type '${dto.type}' requires a plan body`,
        errorCode: PAYMENT_ERRORS.PAYMENT_PLAN_REQUIRED,
      });
    }
    if (!isPlan && dto.plan !== undefined && dto.plan !== null) {
      throw new BadRequestException({
        message: `Plan bodies are only supported for ${PAYMENT_PLAN_KINDS.join(' / ')} payments`,
        errorCode: PAYMENT_ERRORS.PAYMENT_PLAN_NOT_SUPPORTED,
      });
    }

    // 3. Amount sanity cap (DTO already enforces integer > 0).
    this.validateAmount(dto.amountCents);

    // 4. Currency — validated against the shared supported list; free-form is rejected.
    if (!(CURRENCY_CODES as readonly string[]).includes(dto.currency)) {
      throw new BadRequestException({
        message: `Unsupported currency '${dto.currency}'`,
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CURRENCY,
      });
    }

    // 5. Date — reject occurredAt more than 1 day in the future (timezone grace).
    const occurredAt = this.parseAndValidateOccurredAt(dto.occurredAt);

    // 6. Category — reuse CategoryService.findById() for visibility; then check direction.
    const category = await this.loadCategoryOrThrow(userId, dto.categoryId);
    this.ensureCategoryDirectionMatches(category, dto.direction);

    // 7. Attributions — non-empty, well-formed, de-duplicated, in-scope.
    await this.validateAttributions(userId, dto.attributions);

    // 7b. Plan kinds (6.19) — validate + compute the amortisation schedule
    //     BEFORE the transaction so invalid plans never cost a write. The
    //     plan's principal is the payment's own amountCents.
    const planComputed =
      isPlanKind(dto.type) && dto.plan
        ? validatePlanAndCompute(dto.type, dto.amountCents, dto.plan)
        : null;

    // 8. Transaction — Payment + N attributions. The schedule (for RECURRING)
    //    is intentionally NOT created here; the web client posts it as a
    //    separate request to /payments/:id/schedule. Plan kinds DO create
    //    their PaymentPlan + pre-generated occurrences here (6.19) — a plan
    //    parent without its rows would be a broken invariant. The generous
    //    timeout covers up-to-600-row pre-generation on slow CI runners.
    const created = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.create({
          data: {
            direction: dto.direction,
            type: dto.type,
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
        if (planComputed && dto.plan && isPlanKind(dto.type)) {
          await createPlanWithinTransaction(tx, payment, dto.type, dto.plan, planComputed);
        }
        return payment;
      },
      { timeout: planComputed ? 30_000 : 5_000 },
    );

    // 9. Audit — fire-and-forget.
    void this.writeAudit(userId, created.id, 'PAYMENT_CREATED', {
      direction: dto.direction,
      type: dto.type,
      amountCents: dto.amountCents,
      currency: dto.currency,
      categoryId: dto.categoryId,
      attributions: dto.attributions,
      ...(planComputed
        ? {
            plan: {
              paymentsCount: dto.plan!.paymentsCount,
              interestRate: dto.plan!.interestRate,
              frequency: dto.plan!.frequency,
              method: planComputed.method,
            },
          }
        : {}),
    });

    this.logger.log(
      `Payment ${created.id} (${dto.type}, ${dto.direction}) created by user ${userId}`,
    );

    // 10. Serialize + fan out (POST commit). Recipients = creator + all
    // members of any attributed group + every personal-attribution user.
    return this.publishCreated(created as PaymentWithRelations);
  }

  /**
   * Validate the inputs for a receipt-confirmation payment — a `ONE_TIME`
   * `OUT` expense derived from a reviewed receipt (Phase 7.9). Reads only,
   * so it runs before the write transaction; reuses the exact rules create()
   * applies (amount cap, supported currency, non-future date, category
   * visibility + direction, well-formed in-scope attributions). Returns the
   * parsed `occurredAt`.
   */
  async validateExpenseInputs(
    userId: string,
    input: {
      amountCents: number;
      currency: string;
      occurredAt: string;
      categoryId: string;
      attributions: AttributionDto[];
    },
  ): Promise<Date> {
    this.validateAmount(input.amountCents);
    if (!(CURRENCY_CODES as readonly string[]).includes(input.currency)) {
      throw new BadRequestException({
        message: `Unsupported currency '${input.currency}'`,
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CURRENCY,
      });
    }
    const occurredAt = this.parseAndValidateOccurredAt(input.occurredAt);
    const category = await this.loadCategoryOrThrow(userId, input.categoryId);
    this.ensureCategoryDirectionMatches(category, 'OUT');
    await this.validateAttributions(userId, input.attributions);
    return occurredAt;
  }

  /**
   * Create a `ONE_TIME` `OUT` payment (attributions + an optional document)
   * inside a caller-provided transaction. The receipt-confirm flow owns the
   * transaction so the payment, its `PaymentDocument`, and the receipt→payment
   * link all commit atomically. Validation is the caller's responsibility
   * (see {@link validateExpenseInputs}); the post-commit fan-out is
   * {@link publishCreated}.
   */
  async createExpenseWithinTx(
    tx: Prisma.TransactionClient,
    userId: string,
    input: {
      amountCents: number;
      currency: string;
      occurredAt: Date;
      categoryId: string;
      note: string | null;
      attributions: AttributionDto[];
      document?: {
        kind: string;
        fileRef: string;
        originalName: string | null;
        mimeType: string | null;
        sizeBytes: number | null;
      } | null;
    },
  ): Promise<PaymentWithRelations> {
    const payment = await tx.payment.create({
      data: {
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: input.amountCents,
        currency: input.currency,
        occurredAt: input.occurredAt,
        status: 'POSTED',
        categoryId: input.categoryId,
        note: input.note,
        createdById: userId,
        attributions: {
          create: input.attributions.map((a) => ({
            scopeType: a.scope,
            userId: a.scope === 'personal' ? userId : null,
            groupId: a.scope === 'group' ? (a.groupId ?? null) : null,
          })),
        },
        ...(input.document
          ? {
              documents: {
                create: {
                  kind: input.document.kind,
                  fileRef: input.document.fileRef,
                  originalName: input.document.originalName,
                  mimeType: input.document.mimeType,
                  sizeBytes: input.document.sizeBytes,
                  uploadedById: userId,
                },
              },
            }
          : {}),
      },
      include: {
        category: { select: { id: true, slug: true, name: true, icon: true, color: true } },
        attributions: { include: { group: { select: { name: true } } } },
      },
    });
    return payment as PaymentWithRelations;
  }

  /**
   * Serialize a freshly-created payment and fan out `payment.created` to its
   * recipients (creator + every personal-attribution user + all members of
   * any attributed group). Shared by create() and the receipt-confirm flow.
   * Returns the summary so callers can use it as their response body.
   */
  async publishCreated(payment: PaymentWithRelations): Promise<PaymentSummaryDto> {
    const summary = mapPaymentToSummary(payment, { starredByMe: false });
    const recipients = await computePaymentRecipients(
      this.prisma,
      payment.attributions as RecipientAttribution[],
      payment.createdById,
    );
    this.eventBus.publish({ type: 'payment.created', userIds: recipients, payment: summary });
    return summary;
  }

  /**
   * List payments visible to `userId`, honoring the scope / filter / sort / cursor query.
   *
   * Visibility (design §5.2): a payment is visible iff at least one of its
   * attributions is personal to the caller OR targets a group the caller is a
   * member of. Expressed as a single `attributions.some` OR in Prisma so the
   * DB handles it in one query (no N+1).
   */
  async list(userId: string, q: ListPaymentsQueryDto): Promise<PaymentListResponseDto> {
    const sort = q.sort ?? 'date_desc';
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);

    // ── 1. Visibility predicate + scope narrowing ──
    const scopeRaw = q.scope ?? 'all';
    let visibilityClause: Prisma.PaymentWhereInput;

    if (scopeRaw === 'personal') {
      visibilityClause = {
        attributions: { some: { scopeType: 'personal', userId } },
      };
    } else if (scopeRaw.startsWith('group:')) {
      const groupId = scopeRaw.slice('group:'.length);
      const membership = await this.prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership) {
        throw new ForbiddenException({
          message: 'Scope not accessible — user is not a member of the requested group',
          errorCode: PAYMENT_ERRORS.PAYMENT_SCOPE_NOT_ACCESSIBLE,
        });
      }
      visibilityClause = {
        attributions: { some: { scopeType: 'group', groupId } },
      };
    } else {
      // 'all' (default) — shared helper with findByIdForUser / update.
      visibilityClause = this.buildVisibilityWhere(userId);
    }

    const andClauses: Prisma.PaymentWhereInput[] = [visibilityClause];

    // ── 2. Simple column filters ──
    if (q.direction) andClauses.push({ direction: q.direction });
    if (q.categoryId) andClauses.push({ categoryId: q.categoryId });
    if (q.type) andClauses.push({ type: q.type });

    // ── 2a. Recurring-occurrences filters (iteration 6.18.1.3) ──
    //
    // `parentPaymentId` narrows to the children of a single parent. We
    // enforce visibility on the **parent** before listing — without this,
    // a non-member could enumerate child ids by guessing a parent uuid.
    // Fail closed with the same `PAYMENT_NOT_FOUND` code findByIdForUser
    // uses, preserving the no-existence-leak rule.
    if (q.parentPaymentId) {
      await this.assertVisible(userId, q.parentPaymentId);
      andClauses.push({ parentPaymentId: q.parentPaymentId });
    }

    // `withParent=true` → only parents (no parentPaymentId).
    // `withParent=false` → only occurrences (parentPaymentId !== null).
    if (q.withParent === 'true') {
      andClauses.push({ parentPaymentId: null });
    } else if (q.withParent === 'false') {
      andClauses.push({ parentPaymentId: { not: null } });
    }

    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lt = new Date(q.to);
      andClauses.push({ occurredAt: range });
    }

    if (q.search) {
      // MySQL's default utf8mb4_unicode_ci is already case-insensitive on LIKE.
      andClauses.push({ note: { contains: q.search } });
    }

    if (q.starred === 'true') {
      andClauses.push({ stars: { some: { userId } } });
    } else if (q.starred === 'false') {
      andClauses.push({ stars: { none: { userId } } });
    }

    // ── 3. Cursor guard ──
    let cursorPayload: ReturnType<typeof decodeCursor> = null;
    if (q.cursor) {
      cursorPayload = decodeCursor(q.cursor);
      if (!cursorPayload || !isValidCursor(cursorPayload, sort)) {
        throw new BadRequestException({
          message: 'Malformed cursor',
          errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CURSOR,
        });
      }
      andClauses.push(buildCursorGuard(cursorPayload, sort));
    }

    // ── 4. Sort ──
    const orderBy = buildOrderBy(sort);

    // ── 5. Execute ──
    const rows = await this.prisma.payment.findMany({
      where: { AND: andClauses },
      orderBy,
      take: limit + 1,
      include: buildDetailInclude(userId),
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const data = slice.map((p) =>
      mapPaymentToSummary(p as unknown as PaymentWithRelations, {
        starredByMe: p.stars.length > 0,
        commentCount: p._count.comments,
        hasDocuments: p._count.documents > 0,
      }),
    );

    const nextCursor = hasMore ? encodeCursor(buildCursorFor(slice[slice.length - 1], sort)) : null;

    return { data, nextCursor, hasMore };
  }

  /**
   * Get a single payment visible to `userId`. Returns 404 when the row either
   * does not exist OR the user lacks a visibility attribution — the design rule
   * is "don't leak existence" (design §5.2, §5.7).
   */
  async findByIdForUser(userId: string, paymentId: string): Promise<PaymentSummaryDto> {
    const row = await this.prisma.payment.findFirst({
      where: { AND: [{ id: paymentId }, this.buildVisibilityWhere(userId)] },
      include: buildDetailInclude(userId),
    });

    if (!row) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }

    return mapPaymentToSummary(row as unknown as PaymentWithRelations, {
      starredByMe: row.stars.length > 0,
      commentCount: row._count.comments,
      hasDocuments: row._count.documents > 0,
    });
  }

  /**
   * Update scalar fields and/or replace the caller-accessible attribution
   * subset on an existing payment. Creator only.
   *
   * Returns the fresh summary, or `null` when the caller emptied the
   * accessible attribution set and that left the payment with zero rows
   * (hard-deleted → controller emits 204).
   *
   * Design §2.4 / §5.2 (iteration 6.8).
   */
  async update(
    userId: string,
    paymentId: string,
    dto: UpdatePaymentDto,
  ): Promise<PaymentSummaryDto | null> {
    // 1. Fetch with visibility guard — 404 when not visible or missing.
    const existing = await this.prisma.payment.findFirst({
      where: { AND: [{ id: paymentId }, this.buildVisibilityWhere(userId)] },
      include: buildDetailInclude(userId),
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }

    // 2. Creator check.
    if (existing.createdById !== userId) {
      throw new ForbiddenException({
        message: 'Only the creator of a payment may edit it',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_OWNER,
      });
    }

    // 3. Empty body → no-op.
    const hasScalarField =
      dto.direction !== undefined ||
      dto.amountCents !== undefined ||
      dto.currency !== undefined ||
      dto.occurredAt !== undefined ||
      dto.categoryId !== undefined ||
      dto.note !== undefined ||
      dto.type !== undefined;
    const hasAttributionField = dto.attributions !== undefined;

    if (!hasScalarField && !hasAttributionField) {
      return mapPaymentToSummary(existing as unknown as PaymentWithRelations, {
        starredByMe: existing.stars.length > 0,
        commentCount: existing._count.comments,
        hasDocuments: existing._count.documents > 0,
      });
    }

    // 4. Generated-occurrence guard (forward compat for 6.17 / 6.19).
    //
    // Iteration 6.17.4 carve-out: a RECURRING parent CAN be edited iff the
    // sole purpose is changing its `type` (which then cascades the schedule
    // tear-down — see §cascade below). All other RECURRING-parent edits stay
    // 400 to avoid muddying the generated-occurrence semantics.
    const isTypeChange = dto.type !== undefined && dto.type !== existing.type;
    if (existing.parentPaymentId !== null || (existing.type !== 'ONE_TIME' && !isTypeChange)) {
      throw new BadRequestException({
        message:
          'Generated occurrences / schedule-derived payments cannot be edited via this endpoint',
        errorCode: PAYMENT_ERRORS.PAYMENT_CANNOT_EDIT_GENERATED_OCCURRENCE,
      });
    }

    // 5+6. Category + direction compatibility.
    const effectiveDirection = dto.direction ?? (existing.direction as 'IN' | 'OUT');
    const categoryChanging = dto.categoryId !== undefined && dto.categoryId !== existing.categoryId;

    let nextCategoryId = existing.categoryId;
    if (categoryChanging) {
      const cat = await this.loadCategoryOrThrow(userId, dto.categoryId as string);
      this.ensureCategoryDirectionMatches(cat, effectiveDirection);
      nextCategoryId = dto.categoryId as string;
    } else if (dto.direction !== undefined && dto.direction !== existing.direction) {
      // Direction-only change — validate against the existing category.
      const cat = await this.loadCategoryOrThrow(userId, existing.categoryId);
      this.ensureCategoryDirectionMatches(cat, effectiveDirection);
    }

    // 7. Date.
    let nextOccurredAt: Date | undefined;
    if (dto.occurredAt !== undefined) {
      nextOccurredAt = this.parseAndValidateOccurredAt(dto.occurredAt);
    }

    // 8. Amount.
    if (dto.amountCents !== undefined) {
      this.validateAmount(dto.amountCents);
    }

    // 9. Currency — DTO regex already enforces /^[A-Z]{3}$/; also reject unsupported codes.
    if (dto.currency !== undefined) {
      if (!(CURRENCY_CODES as readonly string[]).includes(dto.currency)) {
        throw new BadRequestException({
          message: `Unsupported currency '${dto.currency}'`,
          errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CURRENCY,
        });
      }
    }

    // 10. Attribution diff (when dto.attributions present).
    const existingAttrs = existing.attributions as unknown as AttributionRow[];
    type Diff = {
      toDelete: AttributionRow[];
      toAdd: Array<{
        scopeType: 'personal' | 'group';
        userId: string | null;
        groupId: string | null;
      }>;
      addedForAudit: AttributionDto[];
      removedForAudit: AttributionDto[];
    };
    let attrDiff: Diff | null = null;

    if (hasAttributionField) {
      // Resolve accessible set. (`memberGroups` only covers groups already on
      // the payment; we intentionally don't reuse it as the validator cache.)
      const { accessible } = await this.resolveAccessibleAttributions(userId, existingAttrs);

      // Validate desired (non-empty validation is skipped — empty means "clear").
      // Note: we intentionally let `validateAttributions` fetch its own membership
      // set, because `memberGroups` here only contains groups already on the
      // payment; desired may reference a brand-new group the caller is a member
      // of but which isn't yet attributed.
      const desired = dto.attributions ?? [];
      await this.validateAttributions(userId, desired, undefined, { allowEmpty: true });

      // Index desired by (scope|groupId).
      const key = (a: { scope: 'personal' | 'group'; groupId?: string | null }) =>
        `${a.scope}|${a.groupId ?? ''}`;
      const desiredKeys = new Set(desired.map((d) => key(d)));
      const accessibleKeys = new Set(
        accessible.map((a) =>
          key({ scope: a.scopeType as 'personal' | 'group', groupId: a.groupId }),
        ),
      );

      // Deletes: accessible rows not in desired.
      const toDelete = accessible.filter(
        (a) =>
          !desiredKeys.has(key({ scope: a.scopeType as 'personal' | 'group', groupId: a.groupId })),
      );

      // Adds: desired entries not already on the payment (any attribution).
      const allExistingKeys = new Set(
        existingAttrs.map((a) =>
          key({ scope: a.scopeType as 'personal' | 'group', groupId: a.groupId }),
        ),
      );
      const toAdd: Diff['toAdd'] = [];
      const addedForAudit: AttributionDto[] = [];
      for (const d of desired) {
        const k = key(d);
        if (accessibleKeys.has(k)) continue; // already present + accessible: keep
        if (allExistingKeys.has(k)) {
          // Present on payment but NOT accessible (other user's personal).
          // Caller cannot "add" something they couldn't also delete.
          throw new ForbiddenException({
            message: 'Desired attribution collides with a non-accessible existing attribution',
            errorCode: PAYMENT_ERRORS.PAYMENT_ATTRIBUTION_OUT_OF_SCOPE,
          });
        }
        toAdd.push({
          scopeType: d.scope,
          userId: d.scope === 'personal' ? userId : null,
          groupId: d.scope === 'group' ? (d.groupId ?? null) : null,
        });
        addedForAudit.push(d);
      }
      const removedForAudit: AttributionDto[] = toDelete.map((a) => ({
        scope: a.scopeType as 'personal' | 'group',
        groupId: a.groupId ?? undefined,
      }));
      attrDiff = { toDelete, toAdd, addedForAudit, removedForAudit };
    }

    // 11. Build scalar update payload.
    const data: Prisma.PaymentUpdateInput = {};
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.amountCents !== undefined) data.amountCents = dto.amountCents;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (nextOccurredAt !== undefined) data.occurredAt = nextOccurredAt;
    if (categoryChanging) data.category = { connect: { id: nextCategoryId } };
    if (dto.note !== undefined) data.note = dto.note === '' ? null : dto.note;
    if (dto.type !== undefined) data.type = dto.type;

    // Cascade trigger: parent transitioning out of RECURRING tears down its
    // schedule + scheduler in the same transaction. ONE_TIME → RECURRING is
    // a silent no-op here — the user must POST /schedule to attach one.
    const cascadeOnTypeChange = isTypeChange && existing.type === 'RECURRING';

    // 12. Execute everything in one transaction. The cascade DB writes
    // (schedule row + audit) participate in the tx; the queue mutation
    // happens AFTER commit (Redis I/O held across SQL row locks invites
    // MySQL deadlocks under concurrency — see helper).
    let cascadeRemovedScheduleId: string | null = null;
    const txResult = await this.prisma.$transaction(async (tx) => {
      if (hasScalarField) {
        await tx.payment.update({ where: { id: paymentId }, data });
      }
      if (cascadeOnTypeChange) {
        const cascade = await removeScheduleForPayment(this.prisma, this.queue, paymentId, {
          tx,
          reason: 'parent_type_changed',
          actorId: userId,
        });
        cascadeRemovedScheduleId = cascade.scheduleId;
      }

      let paymentDeleted = false;
      if (attrDiff) {
        if (attrDiff.toDelete.length > 0) {
          await tx.paymentAttribution.deleteMany({
            where: { id: { in: attrDiff.toDelete.map((a) => a.id) } },
          });
        }
        if (attrDiff.toAdd.length > 0) {
          await tx.paymentAttribution.createMany({
            data: attrDiff.toAdd.map((a) => ({
              paymentId,
              scopeType: a.scopeType,
              userId: a.userId,
              groupId: a.groupId,
            })),
          });
        }
        const remaining = await tx.paymentAttribution.count({ where: { paymentId } });
        if (remaining === 0) {
          await tx.payment.delete({ where: { id: paymentId } });
          paymentDeleted = true;
        }
      }

      return { paymentDeleted };
    });

    // Post-commit queue tear-down for the cascade tear-down path. Failure
    // is logged + swallowed; the worker's self-heal path picks up any
    // orphan scheduler key on its next firing.
    if (cascadeRemovedScheduleId !== null) {
      const schedulerId = `payment-schedule:${cascadeRemovedScheduleId}`;
      try {
        await this.queue.removeJobScheduler(schedulerId);
      } catch (err) {
        this.logger.warn(
          `cascade removeJobScheduler(${schedulerId}) failed for payment ${paymentId}: ${(err as Error).message} — worker will self-heal`,
        );
      }
    }

    // 13. Audit — fire-and-forget.
    if (hasScalarField) {
      const changed = Object.keys(dto)
        .filter((k) => k !== 'attributions' && (dto as Record<string, unknown>)[k] !== undefined)
        .sort();
      void this.writeAudit(userId, paymentId, 'PAYMENT_UPDATED', { changed });
    }
    if (attrDiff) {
      for (const removed of attrDiff.removedForAudit) {
        void this.writeAudit(userId, paymentId, 'PAYMENT_ATTRIBUTION_REMOVED', {
          scope: removed.scope,
          groupId: removed.groupId ?? null,
        });
      }
      for (const added of attrDiff.addedForAudit) {
        void this.writeAudit(userId, paymentId, 'PAYMENT_ATTRIBUTION_ADDED', {
          scope: added.scope,
          groupId: added.groupId ?? null,
        });
      }
      if (txResult.paymentDeleted) {
        void this.writeAudit(userId, paymentId, 'PAYMENT_DELETED', {
          reason: 'attributions_empty',
        });
      }
    }

    this.logger.log(
      `Payment ${paymentId} updated by user ${userId} — scalars=${hasScalarField}, attrDiff=${attrDiff ? `+${attrDiff.toAdd.length}/-${attrDiff.toDelete.length}` : 'none'}, deleted=${txResult.paymentDeleted}`,
    );

    // 14. Realtime fan-out — POST commit.
    //
    // For attribution events we union pre + post recipients so a user who
    // *lost* visibility still gets a chance to drop the row from their
    // local list. The payment-level events (updated / deleted) follow the
    // same union for symmetry.
    const preAttrs: RecipientAttribution[] = existingAttrs.map((a) => ({
      scopeType: a.scopeType,
      userId: a.userId,
      groupId: a.groupId,
    }));
    const postAttrs: RecipientAttribution[] = attrDiff
      ? [
          ...existingAttrs
            .filter((a) => !attrDiff!.toDelete.some((d) => d.id === a.id))
            .map((a) => ({ scopeType: a.scopeType, userId: a.userId, groupId: a.groupId })),
          ...attrDiff.toAdd.map((a) => ({
            scopeType: a.scopeType,
            userId: a.userId,
            groupId: a.groupId,
          })),
        ]
      : preAttrs;
    const unionAttrs: RecipientAttribution[] = [...preAttrs, ...postAttrs];
    const recipients = await computePaymentRecipients(
      this.prisma,
      unionAttrs,
      existing.createdById,
    );

    if (txResult.paymentDeleted) {
      this.eventBus.publish({
        type: 'payment.deleted',
        userIds: recipients,
        paymentId,
      });
    }
    if (attrDiff) {
      for (const removed of attrDiff.removedForAudit) {
        this.eventBus.publish({
          type: 'payment_attribution.removed',
          userIds: recipients,
          paymentId,
          scope: removed.scope,
          ...(removed.scope === 'personal' ? { userId } : {}),
          ...(removed.groupId ? { groupId: removed.groupId } : {}),
        });
      }
      for (const added of attrDiff.addedForAudit) {
        this.eventBus.publish({
          type: 'payment_attribution.added',
          userIds: recipients,
          paymentId,
          scope: added.scope,
          ...(added.scope === 'personal' ? { userId } : {}),
          ...(added.groupId ? { groupId: added.groupId } : {}),
        });
      }
    }

    // 15. Return.
    if (txResult.paymentDeleted) return null;

    const fresh = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: buildDetailInclude(userId),
    });
    if (!fresh) return null; // defensive; shouldn't happen
    const freshSummary = mapPaymentToSummary(fresh as unknown as PaymentWithRelations, {
      starredByMe: fresh.stars.length > 0,
      commentCount: fresh._count.comments,
      hasDocuments: fresh._count.documents > 0,
    });

    // Emit payment.updated whenever any scalar OR attribution change actually
    // landed. The frontend treats it as a patch-in-place so emitting on
    // attribution-only edits keeps every viewer's row in sync without
    // needing them to also listen to the per-attribution events.
    if (
      hasScalarField ||
      (attrDiff && (attrDiff.toAdd.length > 0 || attrDiff.toDelete.length > 0))
    ) {
      this.eventBus.publish({
        type: 'payment.updated',
        userIds: recipients,
        payment: freshSummary,
      });
    }

    return freshSummary;
  }

  /**
   * Edit a payment's non-period fields and (optionally) cascade the same
   * field deltas to its child occurrences. Phase 6 · Iteration 6.18.1.5.
   *
   * In-scope fields (this iteration): `direction`, `amountCents`, `currency`,
   * `categoryId`, `note`, and `attributions`. The schedule / period spec
   * (cron / everyMs / startsAt / endsAt / limit) is NOT editable here — it
   * stays read-only until 6.18.2 — and the child-recalculation engine
   * (add/remove occurrences on interval change) is a separate iteration
   * (6.18.1.5.2). `occurredAt` and `type` are intentionally ignored by the
   * cascade path (the single-edit `update()` path owns those).
   *
   * Propagation:
   *  - `self`   handled by the controller via the existing `update()` path.
   *  - `future` parent + children with `occurredAt >= now` (server time).
   *  - `all`    parent + every child.
   *
   * Scope guard: a child is only updated when EVERY one of its attributions
   * is controllable by the editor (their personal scope, or a group they are
   * a member of). Children carrying an attribution to a group the editor is
   * NOT a member of are SKIPPED entirely (never partially edited) and counted
   * in `skippedChildrenCount`. Out-of-scope attributions are never removed.
   *
   * The per-field delta application is a single helper (`applyFieldDeltas`)
   * reused for the parent and every child (DRY). All DB writes run in one
   * transaction; realtime `payment.updated` events fan out AFTER commit.
   */
  async editPaymentWithPropagation(
    userId: string,
    paymentId: string,
    dto: UpdatePaymentDto,
    propagate: PaymentPropagateMode,
  ): Promise<CascadeEditResponseDto> {
    // 1. Fetch parent with visibility guard.
    const existing = await this.prisma.payment.findFirst({
      where: { AND: [{ id: paymentId }, this.buildVisibilityWhere(userId)] },
      include: buildDetailInclude(userId),
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }

    // 2. Creator check.
    if (existing.createdById !== userId) {
      throw new ForbiddenException({
        message: 'Only the creator of a payment may edit it',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_OWNER,
      });
    }

    // 3. Edit eligibility — must be an editable parent (ONE_TIME / RECURRING),
    //    never a generated occurrence.
    if (
      existing.parentPaymentId !== null ||
      (existing.type !== 'ONE_TIME' && existing.type !== 'RECURRING')
    ) {
      throw new BadRequestException({
        message:
          'Generated occurrences / schedule-derived payments cannot be edited via this endpoint',
        errorCode: PAYMENT_ERRORS.PAYMENT_CANNOT_EDIT_GENERATED_OCCURRENCE,
      });
    }

    const existingAttrs = existing.attributions as unknown as AttributionRow[];

    // 4. Determine which non-period fields actually change.
    const hasScalarField =
      dto.direction !== undefined ||
      dto.amountCents !== undefined ||
      dto.currency !== undefined ||
      dto.categoryId !== undefined ||
      dto.note !== undefined;
    const hasAttributionField = dto.attributions !== undefined;

    // 5. Validate scalar fields (reuse the single-edit validators).
    const effectiveDirection = dto.direction ?? (existing.direction as 'IN' | 'OUT');
    const categoryChanging = dto.categoryId !== undefined && dto.categoryId !== existing.categoryId;
    let nextCategoryId = existing.categoryId;
    if (categoryChanging) {
      const cat = await this.loadCategoryOrThrow(userId, dto.categoryId as string);
      this.ensureCategoryDirectionMatches(cat, effectiveDirection);
      nextCategoryId = dto.categoryId as string;
    } else if (dto.direction !== undefined && dto.direction !== existing.direction) {
      const cat = await this.loadCategoryOrThrow(userId, existing.categoryId);
      this.ensureCategoryDirectionMatches(cat, effectiveDirection);
    }
    if (dto.amountCents !== undefined) this.validateAmount(dto.amountCents);
    if (
      dto.currency !== undefined &&
      !(CURRENCY_CODES as readonly string[]).includes(dto.currency)
    ) {
      throw new BadRequestException({
        message: `Unsupported currency '${dto.currency}'`,
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CURRENCY,
      });
    }

    // 6. Validate desired attributions (non-empty, in editor scope).
    const desired = dto.attributions ?? [];
    if (hasAttributionField) {
      await this.validateAttributions(userId, desired);
    }

    // 7. Build the reusable scalar delta payload (parent + each child).
    const scalarData: Prisma.PaymentUpdateInput = {};
    if (dto.direction !== undefined) scalarData.direction = dto.direction;
    if (dto.amountCents !== undefined) scalarData.amountCents = dto.amountCents;
    if (dto.currency !== undefined) scalarData.currency = dto.currency;
    if (categoryChanging) scalarData.category = { connect: { id: nextCategoryId } };
    if (dto.note !== undefined) scalarData.note = dto.note === '' ? null : dto.note;

    // Nothing to do — return the current parent summary with zero counts.
    if (!hasScalarField && !hasAttributionField) {
      return {
        payment: mapPaymentToSummary(existing as unknown as PaymentWithRelations, {
          starredByMe: existing.stars.length > 0,
          commentCount: existing._count.comments,
          hasDocuments: existing._count.documents > 0,
        }),
        affectedChildrenCount: 0,
        skippedChildrenCount: 0,
      };
    }

    // 8. Select target children (only when cascading + parent is RECURRING).
    const now = new Date();
    const cascading = propagate !== 'self' && existing.type === 'RECURRING';
    const children = cascading
      ? await this.prisma.payment.findMany({
          where: {
            parentPaymentId: paymentId,
            ...(propagate === 'future' ? { occurredAt: { gte: now } } : {}),
          },
          include: { attributions: true },
        })
      : [];

    // 9. Editor's member-group set across every referenced group (one query).
    const referencedGroupIds = new Set<string>();
    for (const a of existingAttrs) if (a.groupId) referencedGroupIds.add(a.groupId);
    for (const d of desired) if (d.groupId) referencedGroupIds.add(d.groupId);
    for (const c of children) {
      for (const a of c.attributions) if (a.groupId) referencedGroupIds.add(a.groupId);
    }
    let memberGroups = new Set<string>();
    if (referencedGroupIds.size > 0) {
      const memberships = await this.prisma.groupMembership.findMany({
        where: { userId, groupId: { in: Array.from(referencedGroupIds) } },
        select: { groupId: true },
      });
      memberGroups = new Set(memberships.map((m) => m.groupId));
    }

    // 10. Partition children: controllable (every attribution in editor scope)
    //     vs. skipped (any attribution targets a non-member group).
    const controllableChildren: typeof children = [];
    let skippedChildrenCount = 0;
    for (const c of children) {
      const controllable = c.attributions.every(
        (a) =>
          (a.scopeType === 'personal' && a.userId === userId) ||
          (a.scopeType === 'group' && a.groupId !== null && memberGroups.has(a.groupId)),
      );
      if (controllable) controllableChildren.push(c);
      else skippedChildrenCount += 1;
    }

    // 11. Plan attribution replacement for parent + each controllable child.
    const attrPlanFor = hasAttributionField
      ? (attrs: AttributionRow[]) => planAttributionReplace(attrs, desired, userId, memberGroups)
      : null;

    // 12. Transaction — apply deltas to parent + every controllable child.
    await this.prisma.$transaction(async (tx) => {
      await this.applyFieldDeltas(tx, paymentId, existingAttrs, scalarData, attrPlanFor);
      for (const c of controllableChildren) {
        await this.applyFieldDeltas(
          tx,
          c.id,
          c.attributions as unknown as AttributionRow[],
          scalarData,
          attrPlanFor,
        );
      }
    });

    // 13. Audit — fire-and-forget, one row per affected payment.
    const changed = Object.keys(dto)
      .filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
      .sort();
    void this.writeAudit(userId, paymentId, 'PAYMENT_UPDATED', { changed, propagate });
    for (const c of controllableChildren) {
      void this.writeAudit(userId, c.id, 'PAYMENT_UPDATED', {
        changed,
        propagate,
        cascadedFrom: paymentId,
      });
    }

    this.logger.log(
      `Payment ${paymentId} cascade-edited by ${userId} — propagate=${propagate}, ` +
        `children affected=${controllableChildren.length}, skipped=${skippedChildrenCount}`,
    );

    // 14. Realtime fan-out — POST commit. One payment.updated per affected
    //     payment, each with its own multicast recipients (union pre + post
    //     attributions so users who lost visibility can drop the row).
    const parentFresh = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: buildDetailInclude(userId),
    });
    let parentSummary: PaymentSummaryDto;
    if (parentFresh) {
      parentSummary = mapPaymentToSummary(parentFresh as unknown as PaymentWithRelations, {
        starredByMe: parentFresh.stars.length > 0,
        commentCount: parentFresh._count.comments,
        hasDocuments: parentFresh._count.documents > 0,
      });
      const parentRecipients = await computePaymentRecipients(
        this.prisma,
        unionAttributions(existingAttrs, attrPlanFor ? attrPlanFor(existingAttrs).postAttrs : null),
        existing.createdById,
      );
      this.eventBus.publish({
        type: 'payment.updated',
        userIds: parentRecipients,
        payment: parentSummary,
      });
    } else {
      // Defensive — shouldn't happen since we only update, never delete here.
      parentSummary = mapPaymentToSummary(existing as unknown as PaymentWithRelations, {
        starredByMe: existing.stars.length > 0,
        commentCount: existing._count.comments,
        hasDocuments: existing._count.documents > 0,
      });
    }

    for (const c of controllableChildren) {
      const childFresh = await this.prisma.payment.findUnique({
        where: { id: c.id },
        include: buildDetailInclude(userId),
      });
      if (!childFresh) continue;
      const childSummary = mapPaymentToSummary(childFresh as unknown as PaymentWithRelations, {
        starredByMe: childFresh.stars.length > 0,
        commentCount: childFresh._count.comments,
        hasDocuments: childFresh._count.documents > 0,
      });
      const childAttrs = c.attributions as unknown as AttributionRow[];
      const recipients = await computePaymentRecipients(
        this.prisma,
        unionAttributions(childAttrs, attrPlanFor ? attrPlanFor(childAttrs).postAttrs : null),
        childFresh.createdById,
      );
      this.eventBus.publish({
        type: 'payment.updated',
        userIds: recipients,
        payment: childSummary,
      });
    }

    return {
      payment: parentSummary,
      affectedChildrenCount: controllableChildren.length,
      skippedChildrenCount,
    };
  }

  /**
   * Apply a non-period field delta to a single payment inside a transaction.
   * Reused for the parent and every controllable child (DRY — Phase 6 ·
   * Iteration 6.18.1.5). Scalars are a plain update; attributions replace the
   * editor-controllable subset with `desired`, preserving any out-of-scope
   * attribution the editor cannot control.
   */
  private async applyFieldDeltas(
    tx: Prisma.TransactionClient,
    targetId: string,
    targetAttrs: AttributionRow[],
    scalarData: Prisma.PaymentUpdateInput,
    attrPlanFor: ((attrs: AttributionRow[]) => ReturnType<typeof planAttributionReplace>) | null,
  ): Promise<void> {
    if (Object.keys(scalarData).length > 0) {
      await tx.payment.update({ where: { id: targetId }, data: scalarData });
    }
    if (attrPlanFor) {
      const plan = attrPlanFor(targetAttrs);
      if (plan.toDeleteIds.length > 0) {
        await tx.paymentAttribution.deleteMany({ where: { id: { in: plan.toDeleteIds } } });
      }
      if (plan.toCreate.length > 0) {
        await tx.paymentAttribution.createMany({
          data: plan.toCreate.map((a) => ({
            paymentId: targetId,
            scopeType: a.scopeType,
            userId: a.userId,
            groupId: a.groupId,
          })),
        });
      }
    }
  }

  /**
   * Scoped-delete (DELETE /payments/:id). See design §2.4 + §5.2.
   *
   * The `scope` query narrows what is removed. When the caller ends up with
   * zero attributions on the payment, the Payment row is hard-deleted and
   * cascades clean up stars / comments / documents / schedule / plan
   * (onDelete: Cascade declared in the schema from iteration 6.2).
   */
  async remove(
    userId: string,
    paymentId: string,
    query: DeletePaymentQueryDto,
  ): Promise<AttributionChangeResultDto> {
    // 1. Fetch the payment (raw — visibility is enforced via accessible set below).
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { attributions: true },
    });
    if (!payment) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }

    const existingAttrs = payment.attributions as unknown as AttributionRow[];

    // 2. Resolve caller-accessible attributions.
    const { accessible, personal, memberGroups } = await this.resolveAccessibleAttributions(
      userId,
      existingAttrs,
    );
    if (accessible.length === 0) {
      // Caller can't see this payment → 404 (don't leak existence).
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }

    // 3. Scope resolution → target attribution ids.
    const scope = query.scope;
    let targets: AttributionRow[];
    if (scope === undefined) {
      if (accessible.length === 1) {
        targets = [accessible[0]];
      } else {
        const accessibleScopes = this.describeAccessibleScopes(accessible);
        throw new ConflictException({
          message: 'Scope is ambiguous — pass ?scope=personal | group:<id> | all',
          errorCode: PAYMENT_ERRORS.PAYMENT_SCOPE_AMBIGUOUS,
          details: { accessibleScopes },
        });
      }
    } else if (scope === 'personal') {
      if (!personal) {
        throw new ConflictException({
          message: 'Caller has no personal attribution on this payment',
          errorCode: PAYMENT_ERRORS.PAYMENT_SCOPE_NOT_ATTRIBUTED,
        });
      }
      targets = [personal];
    } else if (scope === 'all') {
      if (accessible.length === 0) {
        throw new ConflictException({
          message: 'No accessible attributions to remove',
          errorCode: PAYMENT_ERRORS.PAYMENT_NO_ACCESSIBLE_ATTRIBUTION,
        });
      }
      targets = accessible.slice();
    } else if (scope.startsWith('group:')) {
      const gid = scope.slice('group:'.length);
      if (!memberGroups.has(gid)) {
        // Non-member for that group → still 409 NOT_ATTRIBUTED (404-on-entity rule
        // only applies when the *payment* is non-visible).
        throw new ConflictException({
          message: `Caller has no accessible attribution with scope group:${gid} on this payment`,
          errorCode: PAYMENT_ERRORS.PAYMENT_SCOPE_NOT_ATTRIBUTED,
        });
      }
      const match = accessible.find((a) => a.scopeType === 'group' && a.groupId === gid);
      if (!match) {
        throw new ConflictException({
          message: `Caller has no accessible attribution with scope group:${gid} on this payment`,
          errorCode: PAYMENT_ERRORS.PAYMENT_SCOPE_NOT_ATTRIBUTED,
        });
      }
      targets = [match];
    } else {
      // DTO regex should have caught this; defensively treat as ambiguous.
      throw new ConflictException({
        message: `Invalid scope '${scope}'`,
        errorCode: PAYMENT_ERRORS.PAYMENT_SCOPE_AMBIGUOUS,
      });
    }

    const targetIds = targets.map((t) => t.id);

    // 4. Transactional delete. On the final hard-delete branch we cascade
    // the schedule (DB row + audit) BEFORE the parent row goes away. The
    // BullMQ scheduler key is removed AFTER the tx commits — Redis I/O
    // inside a SQL transaction triggers MySQL deadlocks under concurrent
    // load. Worker self-heal covers any divergence if Redis is down.
    let cascadeRemovedScheduleId: string | null = null;
    const { paymentDeleted } = await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttribution.deleteMany({ where: { id: { in: targetIds } } });
      const remaining = await tx.paymentAttribution.count({ where: { paymentId } });
      let hardDeleted = false;
      if (remaining === 0) {
        const cascade = await removeScheduleForPayment(this.prisma, this.queue, paymentId, {
          tx,
          reason: 'parent_deleted',
          actorId: userId,
        });
        cascadeRemovedScheduleId = cascade.scheduleId;
        await tx.payment.delete({ where: { id: paymentId } });
        hardDeleted = true;
      }
      return { paymentDeleted: hardDeleted };
    });

    if (cascadeRemovedScheduleId !== null) {
      const schedulerId = `payment-schedule:${cascadeRemovedScheduleId}`;
      try {
        await this.queue.removeJobScheduler(schedulerId);
      } catch (err) {
        this.logger.warn(
          `cascade removeJobScheduler(${schedulerId}) failed for payment ${paymentId}: ${(err as Error).message} — worker will self-heal`,
        );
      }
    }

    // 5. Audit (best-effort).
    for (const t of targets) {
      void this.writeAudit(userId, paymentId, 'PAYMENT_ATTRIBUTION_REMOVED', {
        scope: t.scopeType,
        groupId: t.groupId ?? null,
      });
    }
    if (paymentDeleted) {
      void this.writeAudit(userId, paymentId, 'PAYMENT_DELETED', {
        reason: 'scope_delete',
        scope: scope ?? 'implicit',
      });
    }

    this.logger.log(
      `Payment ${paymentId} scoped-delete by user ${userId} — targets=${targetIds.length}, paymentDeleted=${paymentDeleted}`,
    );

    // 6. Assemble response.
    let summary: PaymentSummaryDto | null = null;
    if (!paymentDeleted) {
      const fresh = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: buildDetailInclude(userId),
      });
      if (fresh) {
        summary = mapPaymentToSummary(fresh as unknown as PaymentWithRelations, {
          starredByMe: fresh.stars.length > 0,
          commentCount: fresh._count.comments,
          hasDocuments: fresh._count.documents > 0,
        });
      }
    }

    // 7. Realtime fan-out — POST commit. Recipients = pre-delete viewers
    // (so users who lost visibility still receive the removal event and
    // can drop the row from their local lists).
    const recipients = await computePaymentRecipients(
      this.prisma,
      existingAttrs.map((a) => ({
        scopeType: a.scopeType,
        userId: a.userId,
        groupId: a.groupId,
      })),
      payment.createdById,
    );
    if (paymentDeleted) {
      this.eventBus.publish({
        type: 'payment.deleted',
        userIds: recipients,
        paymentId,
      });
    } else {
      for (const t of targets) {
        this.eventBus.publish({
          type: 'payment_attribution.removed',
          userIds: recipients,
          paymentId,
          scope: t.scopeType as 'personal' | 'group',
          ...(t.scopeType === 'personal' && t.userId ? { userId: t.userId } : {}),
          ...(t.groupId ? { groupId: t.groupId } : {}),
        });
      }
      if (summary) {
        this.eventBus.publish({
          type: 'payment.updated',
          userIds: recipients,
          payment: summary,
        });
      }
    }

    return {
      deletedAttributions: targetIds.length,
      addedAttributions: 0,
      paymentDeleted,
      payment: summary,
    };
  }

  // ── helpers ──

  private validateAmount(amountCents: number): void {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BadRequestException({
        message: 'amountCents must be a positive integer',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT,
      });
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      throw new BadRequestException({
        message: 'amountCents exceeds the maximum allowed value',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_AMOUNT,
      });
    }
  }

  private parseAndValidateOccurredAt(iso: string): Date {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({
        message: 'occurredAt is not a valid ISO 8601 date',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_DATE,
      });
    }
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (d.getTime() > Date.now() + oneDayMs) {
      throw new BadRequestException({
        message: 'occurredAt cannot be in the future',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_DATE,
      });
    }
    return d;
  }

  private async loadCategoryOrThrow(
    userId: string,
    categoryId: string,
  ): Promise<Awaited<ReturnType<CategoryService['findById']>>> {
    try {
      return await this.categoryService.findById(userId, categoryId);
    } catch {
      throw new NotFoundException({
        message: 'Category not found or not visible to the user',
        errorCode: PAYMENT_ERRORS.PAYMENT_INVALID_CATEGORY,
      });
    }
  }

  private ensureCategoryDirectionMatches(
    category: { direction: string },
    direction: 'IN' | 'OUT',
  ): void {
    if (category.direction !== 'BOTH' && category.direction !== direction) {
      throw new BadRequestException({
        message: `Category direction '${category.direction}' does not accept payments of direction '${direction}'`,
        errorCode: PAYMENT_ERRORS.PAYMENT_CATEGORY_DIRECTION_MISMATCH,
      });
    }
  }

  /**
   * Shared attribution validator — used by create() and update().
   *
   * When `allowEmpty=true`, an empty list is allowed (update() expresses
   * "clear all accessible attributions" that way). When `memberGroupsCache`
   * is supplied, group-membership checks reuse it without a DB round-trip.
   */
  private async validateAttributions(
    userId: string,
    attributions: AttributionDto[],
    memberGroupsCache?: Set<string>,
    opts: { allowEmpty?: boolean } = {},
  ): Promise<void> {
    if (!attributions || attributions.length === 0) {
      if (opts.allowEmpty) return;
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
      let memberGroupIds: Set<string>;
      if (memberGroupsCache) {
        memberGroupIds = memberGroupsCache;
      } else {
        const memberships = await this.prisma.groupMembership.findMany({
          where: { userId, groupId: { in: Array.from(groupIdsToCheck) } },
          select: { groupId: true },
        });
        memberGroupIds = new Set(memberships.map((m) => m.groupId));
      }
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

  /**
   * Partition a payment's attribution rows into the subset the caller can
   * control (their personal + member groups) and preload their group-
   * membership set in one query (no N+1). Iteration 6.8 helper, used by
   * `remove()` and the attribution-diff branch of `update()`.
   */
  private async resolveAccessibleAttributions(
    userId: string,
    attributions: AttributionRow[],
  ): Promise<{
    accessible: AttributionRow[];
    personal: AttributionRow | null;
    memberGroups: Set<string>;
  }> {
    const groupIdsOnPayment = Array.from(
      new Set(
        attributions
          .filter((a) => a.scopeType === 'group' && a.groupId)
          .map((a) => a.groupId as string),
      ),
    );
    let memberGroups = new Set<string>();
    if (groupIdsOnPayment.length > 0) {
      const memberships = await this.prisma.groupMembership.findMany({
        where: { userId, groupId: { in: groupIdsOnPayment } },
        select: { groupId: true },
      });
      memberGroups = new Set(memberships.map((m) => m.groupId));
    }

    const accessible: AttributionRow[] = [];
    let personal: AttributionRow | null = null;
    for (const a of attributions) {
      if (a.scopeType === 'personal' && a.userId === userId) {
        accessible.push(a);
        personal = a;
      } else if (a.scopeType === 'group' && a.groupId && memberGroups.has(a.groupId)) {
        accessible.push(a);
      }
    }
    return { accessible, personal, memberGroups };
  }

  /** Human-readable list of the caller's accessible scopes (for error details). */
  private describeAccessibleScopes(accessible: AttributionRow[]): string[] {
    return accessible.map((a) => (a.scopeType === 'personal' ? 'personal' : `group:${a.groupId}`));
  }

  /**
   * Toggle the caller's `PaymentStar` row for a payment (iteration 6.9).
   *
   * Gated by the shared visibility predicate — 404 when the caller cannot see
   * the payment (no existence leak). Create vs. delete runs inside a single
   * `$transaction` so concurrent double-taps can't duplicate rows or leave
   * the row set inconsistent.
   */
  async toggleStar(userId: string, paymentId: string): Promise<ToggleStarResponseDto> {
    // 1. Visibility check — lightweight, just need the id.
    const visible = await this.prisma.payment.findFirst({
      where: { AND: [{ id: paymentId }, this.buildVisibilityWhere(userId)] },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: PAYMENT_ERRORS.PAYMENT_NOT_FOUND,
      });
    }

    // 2. Toggle atomically. Compound unique is `paymentId_userId`.
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.paymentStar.findUnique({
        where: { paymentId_userId: { paymentId, userId } },
      });
      if (existing) {
        await tx.paymentStar.delete({ where: { id: existing.id } });
        return { starred: false };
      }
      await tx.paymentStar.create({ data: { paymentId, userId } });
      return { starred: true };
    });

    // 3. Cheap aggregate for the response.
    const starCount = await this.prisma.paymentStar.count({ where: { paymentId } });

    // 4. Audit — fire-and-forget, don't break the request on audit failure.
    void this.writeAudit(
      userId,
      paymentId,
      result.starred ? 'PAYMENT_STARRED' : 'PAYMENT_UNSTARRED',
      {},
    );

    this.logger.log(
      `Payment ${paymentId} star toggled by user ${userId} → starred=${result.starred}, total=${starCount}`,
    );

    return { starred: result.starred, starCount };
  }

  private async writeAudit(
    userId: string,
    paymentId: string,
    action:
      | 'PAYMENT_CREATED'
      | 'PAYMENT_UPDATED'
      | 'PAYMENT_DELETED'
      | 'PAYMENT_ATTRIBUTION_ADDED'
      | 'PAYMENT_ATTRIBUTION_REMOVED'
      | 'PAYMENT_STARRED'
      | 'PAYMENT_UNSTARRED',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Payment',
          entityId: paymentId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${paymentId}: ${(err as Error).message}`,
      );
    }
  }
}

/** Re-export for symmetry with other services that keep currency types local. */
export type { CurrencyCode };

// ── Cascade-edit attribution helpers (Phase 6 · Iteration 6.18.1.5) ──

/** Stable identity key for an attribution by (scopeType|groupId). */
function attributionKey(scopeType: string, groupId: string | null | undefined): string {
  return `${scopeType}|${groupId ?? ''}`;
}

/** A single attribution row to create as part of a delta apply. */
interface AttributionCreate {
  scopeType: 'personal' | 'group';
  userId: string | null;
  groupId: string | null;
}

/**
 * Compute the attribution replacement plan for one payment: delete the
 * editor-controllable rows, (re)create the `desired` set, and preserve any
 * out-of-scope attribution the editor cannot control. Also returns the
 * post-apply attribution set (for realtime recipient computation).
 */
function planAttributionReplace(
  targetAttrs: AttributionRow[],
  desired: AttributionDto[],
  userId: string,
  memberGroups: Set<string>,
): {
  toDeleteIds: string[];
  toCreate: AttributionCreate[];
  postAttrs: RecipientAttribution[];
} {
  const controllable = (a: AttributionRow): boolean =>
    (a.scopeType === 'personal' && a.userId === userId) ||
    (a.scopeType === 'group' && a.groupId !== null && memberGroups.has(a.groupId));

  const keep = targetAttrs.filter((a) => !controllable(a));
  const remove = targetAttrs.filter((a) => controllable(a));
  const keepKeys = new Set(keep.map((a) => attributionKey(a.scopeType, a.groupId)));

  const toCreate: AttributionCreate[] = desired
    .filter((d) => !keepKeys.has(attributionKey(d.scope, d.groupId ?? null)))
    .map((d) => ({
      scopeType: d.scope,
      userId: d.scope === 'personal' ? userId : null,
      groupId: d.scope === 'group' ? (d.groupId ?? null) : null,
    }));

  const postAttrs: RecipientAttribution[] = [
    ...keep.map((a) => ({ scopeType: a.scopeType, userId: a.userId, groupId: a.groupId })),
    ...toCreate.map((a) => ({ scopeType: a.scopeType, userId: a.userId, groupId: a.groupId })),
  ];

  return { toDeleteIds: remove.map((a) => a.id), toCreate, postAttrs };
}

/**
 * Union the pre-change attribution rows with the post-change set (when
 * attributions changed) so realtime recipients include users who *lost*
 * visibility and need to drop the row.
 */
function unionAttributions(
  preAttrs: AttributionRow[],
  postAttrs: RecipientAttribution[] | null,
): RecipientAttribution[] {
  const pre: RecipientAttribution[] = preAttrs.map((a) => ({
    scopeType: a.scopeType,
    userId: a.userId,
    groupId: a.groupId,
  }));
  return postAttrs ? [...pre, ...postAttrs] : pre;
}

// ── Cursor helpers (co-located per iteration 6.6 spec) ──

type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

type DateCursor = { k: 'date'; occurredAt: string; id: string };
type AmountCursor = { k: 'amount'; amountCents: number; id: string };
type Cursor = DateCursor | AmountCursor;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Cursor;
  } catch {
    return null;
  }
}

/** Runtime guard: the cursor shape must match the active sort. */
export function isValidCursor(cursor: Cursor, sort: SortKey): boolean {
  if (typeof cursor !== 'object' || cursor === null) return false;
  if (sort === 'date_desc' || sort === 'date_asc') {
    const c = cursor as DateCursor;
    if (c.k !== 'date') return false;
    if (typeof c.occurredAt !== 'string' || typeof c.id !== 'string') return false;
    if (Number.isNaN(new Date(c.occurredAt).getTime())) return false;
    return true;
  }
  const c = cursor as AmountCursor;
  if (c.k !== 'amount') return false;
  if (!Number.isFinite(c.amountCents) || typeof c.id !== 'string') return false;
  return true;
}

export function buildOrderBy(sort: SortKey): Prisma.PaymentOrderByWithRelationInput[] {
  switch (sort) {
    case 'date_asc':
      return [{ occurredAt: 'asc' }, { id: 'asc' }];
    case 'amount_desc':
      return [{ amountCents: 'desc' }, { id: 'desc' }];
    case 'amount_asc':
      return [{ amountCents: 'asc' }, { id: 'asc' }];
    case 'date_desc':
    default:
      return [{ occurredAt: 'desc' }, { id: 'desc' }];
  }
}

/** Build the WHERE guard that keeps pagination strictly forward. */
export function buildCursorGuard(cursor: Cursor, sort: SortKey): Prisma.PaymentWhereInput {
  if (cursor.k === 'date') {
    const d = new Date(cursor.occurredAt);
    if (sort === 'date_desc') {
      return {
        OR: [{ occurredAt: { lt: d } }, { occurredAt: d, id: { lt: cursor.id } }],
      };
    }
    // date_asc
    return {
      OR: [{ occurredAt: { gt: d } }, { occurredAt: d, id: { gt: cursor.id } }],
    };
  }
  const amt = cursor.amountCents;
  if (sort === 'amount_desc') {
    return {
      OR: [{ amountCents: { lt: amt } }, { amountCents: amt, id: { lt: cursor.id } }],
    };
  }
  // amount_asc
  return {
    OR: [{ amountCents: { gt: amt } }, { amountCents: amt, id: { gt: cursor.id } }],
  };
}

/** Produce the cursor payload for the last row on a page, based on the active sort. */
export function buildCursorFor(
  row: { id: string; occurredAt: Date; amountCents: number },
  sort: SortKey,
): Cursor {
  if (sort === 'amount_desc' || sort === 'amount_asc') {
    return { k: 'amount', amountCents: row.amountCents, id: row.id };
  }
  return { k: 'date', occurredAt: row.occurredAt.toISOString(), id: row.id };
}
