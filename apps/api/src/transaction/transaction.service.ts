import { CURRENCY_CODES, CurrencyCode, isPlanKind, TRANSACTION_PLAN_KINDS } from '@myfinpro/shared';
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
import { TRANSACTION_OCCURRENCES_QUEUE } from '../queue/queue.constants';
import { EventBus } from '../realtime/event-bus.service';
import { TRANSACTION_ERRORS } from './constants/transaction-errors';
import { AttributionChangeResultDto } from './dto/attribution-change-result.dto';
import { AttributionDto } from './dto/attribution.dto';
import { CascadeEditResponseDto } from './dto/cascade-edit-response.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { DeleteTransactionQueryDto } from './dto/delete-transaction.query.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { ToggleStarResponseDto } from './dto/toggle-star-response.dto';
import { TransactionListResponseDto } from './dto/transaction-list-response.dto';
import {
  TransactionAttributionSummary,
  TransactionCategorySummary,
  TransactionSummaryDto,
} from './dto/transaction-summary.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionPropagateMode } from './dto/update-transaction.query.dto';
import { createPlanWithinTransaction, validatePlanAndCompute } from './transaction-plan.create';
import { removeScheduleForTransaction } from './utils/schedule-cascade';
import {
  computeTransactionRecipients,
  type RecipientAttribution,
} from './utils/transaction-event-recipients';

/** Sanity cap (~$1 billion in cents); keeps amountCents well inside a 32-bit Int column. */
const MAX_AMOUNT_CENTS = 1e11;

/**
 * Transaction types that the create flow accepts today.
 *
 * - `ONE_TIME` — shipped in iteration 6.5.
 * - `RECURRING` — shipped in iteration 6.18.1.1; the schedule sub-resource
 *   (POST /transactions/:id/schedule) is created in a separate request.
 *
 * Other `TransactionType` enum values (`LIMITED_PERIOD`, `INSTALLMENT`, `LOAN`,
 * `MORTGAGE`) are intentionally absent: their behaviour is deferred to phase
 * 7+ per the design doc, and the create endpoint surfaces that with the
 * structured `TRANSACTION_TYPE_NOT_IMPLEMENTED` error code.
 */
export const SUPPORTED_CREATE_TYPES = ['ONE_TIME', 'RECURRING'] as const;
export type SupportedCreateType = (typeof SUPPORTED_CREATE_TYPES)[number];

/**
 * Single source of truth for the relation load used by list(), findByIdForUser(),
 * and update(). Keeps mapping code honest — every path feeds the same shape into
 * `mapTransactionToSummary()`, so rendering diffs can only come from row values, not
 * include drift.
 */
export const TRANSACTION_DETAIL_INCLUDE = {
  category: {
    select: { id: true, slug: true, name: true, icon: true, color: true },
  },
  attributions: { include: { group: { select: { name: true } } } },
  stars: { select: { id: true }, where: {} as { userId?: string } },
  _count: { select: { comments: true, documents: true } },
  // Back-link to the source receipt when the transaction came from confirming
  // one (7.13) — a receipt is the transaction's proving document.
  receipt: { select: { id: true } },
} as const;

/** Build the include with the `stars.where.userId` set to the viewer. */
function buildDetailInclude(userId: string) {
  return {
    category: TRANSACTION_DETAIL_INCLUDE.category,
    attributions: TRANSACTION_DETAIL_INCLUDE.attributions,
    stars: { where: { userId }, select: { id: true } },
    _count: TRANSACTION_DETAIL_INCLUDE._count,
    receipt: TRANSACTION_DETAIL_INCLUDE.receipt,
  } satisfies Prisma.TransactionInclude;
}

/** One row shape we need from `transactionAttribution` when running the
 *  iteration 6.8 scope resolver. Matches the raw Prisma row without the
 *  `group` relation (we only need `id/scopeType/userId/groupId` to make
 *  the accessibility + diff decisions). */
export type AttributionRow = {
  id: string;
  scopeType: string;
  userId: string | null;
  groupId: string | null;
};

/** Minimal Transaction+relations shape we need to produce a summary DTO. */
export type TransactionWithRelations = {
  id: string;
  direction: string;
  type: string;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  status: string;
  note: string | null;
  parentTransactionId: string | null;
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
  /** Loaded by the detail include only; undefined on list rows. */
  receipt?: { id: string } | null;
};

/**
 * Map a persisted Transaction (with category + attributions + attribution.group loaded)
 * into the wire-level `TransactionSummaryDto`. Shared by create / list / get / update.
 */
export function mapTransactionToSummary(
  transaction: TransactionWithRelations,
  opts: { starredByMe: boolean; commentCount?: number; hasDocuments?: boolean },
): TransactionSummaryDto {
  const category: TransactionCategorySummary = {
    id: transaction.category.id,
    slug: transaction.category.slug,
    name: transaction.category.name,
    icon: transaction.category.icon,
    color: transaction.category.color,
  };

  const attributions: TransactionAttributionSummary[] = transaction.attributions.map((a) => ({
    scope: a.scopeType as 'personal' | 'group',
    userId: a.userId,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
  }));

  return {
    id: transaction.id,
    direction: transaction.direction as 'IN' | 'OUT',
    type: transaction.type,
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    occurredAt: transaction.occurredAt.toISOString(),
    status: transaction.status,
    category,
    attributions,
    note: transaction.note,
    commentCount: opts.commentCount ?? 0,
    starredByMe: opts.starredByMe,
    hasDocuments: opts.hasDocuments ?? false,
    receiptId: transaction.receipt?.id ?? null,
    parentTransactionId: transaction.parentTransactionId,
    createdById: transaction.createdById,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryService: CategoryService,
    @InjectQueue(TRANSACTION_OCCURRENCES_QUEUE) private readonly queue: Queue,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Visibility predicate (design §5.2): a transaction is visible to `userId` iff at
   * least one of its attributions is personal to them OR targets a group they
   * are a member of. Shared between list() (scope=all), findByIdForUser(), and
   * update() — one source of truth for access logic.
   */
  private buildVisibilityWhere(userId: string): Prisma.TransactionWhereInput {
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
   * Throws `NotFoundException` with `TRANSACTION_NOT_FOUND` when `transactionId` does
   * not exist OR when the caller has no qualifying attribution. Intended for
   * sibling services (e.g. `TransactionCommentService`) that need to enforce
   * "any user with transaction access" without duplicating the predicate. The
   * existing in-service call sites (`findByIdForUser`, `update`, `remove`,
   * `toggleStar`) keep their inline fetch+check to avoid touching battle-
   * tested code paths; see progress iteration 6.10 for the refactor-scope
   * decision.
   */
  async assertVisible(userId: string, transactionId: string): Promise<void> {
    const visible = await this.prisma.transaction.findFirst({
      where: { AND: [{ id: transactionId }, this.buildVisibilityWhere(userId)] },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }
  }

  /**
   * Create a ONE_TIME or RECURRING transaction with N attributions in a single transaction.
   *
   * Iteration 6.5 introduced the endpoint behind a strict ONE_TIME-only guard;
   * iteration 6.18.1.1 lifts the guard to also accept RECURRING because the
   * recurring infrastructure (schedule CRUD, worker, cascade) shipped fully in
   * 6.17.1–6.17.4 and the web client (6.18.1) needs the parent row before it
   * can POST the schedule sub-resource. The remaining types (LIMITED_PERIOD,
   * INSTALLMENT, LOAN, MORTGAGE) keep returning TRANSACTION_TYPE_NOT_IMPLEMENTED;
   * they are scheduled for phase 7+.
   *
   * Note on RECURRING: this method only inserts the parent row — it does NOT
   * auto-create a `TransactionSchedule`. The web client follows up with a second
   * POST to `/transactions/:id/schedule` (the two-step create from 6.18.1), and
   * the server keeps that resource separate so the schedule lifecycle stays
   * orthogonal to the transaction lifecycle.
   *
   * See design §5.2 "Transactions" for validation rules and §5.7 for error codes.
   */
  async create(userId: string, dto: CreateTransactionDto): Promise<TransactionSummaryDto> {
    // 1. Type guard — ONE_TIME (6.5), RECURRING (6.18.1.1), and the plan
    //    kinds INSTALLMENT / LOAN / MORTGAGE (6.19) are implemented.
    //    LIMITED_PERIOD remains deferred.
    const isPlan = isPlanKind(dto.type);
    if (!(SUPPORTED_CREATE_TYPES as readonly string[]).includes(dto.type) && !isPlan) {
      throw new BadRequestException({
        message: `Transaction type '${dto.type}' is not implemented yet`,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_TYPE_NOT_IMPLEMENTED,
      });
    }

    // 2. Schedule guard — reserved (schedules are a separate sub-resource,
    //    posted by the client after the parent exists — see 6.18.1).
    if (dto.schedule !== undefined && dto.schedule !== null) {
      throw new BadRequestException({
        message: 'Schedule bodies are not supported yet',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCHEDULE_NOT_SUPPORTED,
      });
    }
    // 2b. Plan body — required for plan kinds (a plan parent without its
    //     occurrence rows would be a broken invariant), rejected otherwise.
    if (isPlan && (dto.plan === undefined || dto.plan === null)) {
      throw new BadRequestException({
        message: `Transaction type '${dto.type}' requires a plan body`,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_PLAN_REQUIRED,
      });
    }
    if (!isPlan && dto.plan !== undefined && dto.plan !== null) {
      throw new BadRequestException({
        message: `Plan bodies are only supported for ${TRANSACTION_PLAN_KINDS.join(' / ')} transactions`,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_PLAN_NOT_SUPPORTED,
      });
    }

    // 3. Amount sanity cap (DTO already enforces integer > 0).
    this.validateAmount(dto.amountCents);

    // 4. Currency — validated against the shared supported list; free-form is rejected.
    if (!(CURRENCY_CODES as readonly string[]).includes(dto.currency)) {
      throw new BadRequestException({
        message: `Unsupported currency '${dto.currency}'`,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_CURRENCY,
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
    //     plan's principal is the transaction's own amountCents.
    const planComputed =
      isPlanKind(dto.type) && dto.plan
        ? validatePlanAndCompute(dto.type, dto.amountCents, dto.plan)
        : null;

    // 8. Transaction — Transaction + N attributions. The schedule (for RECURRING)
    //    is intentionally NOT created here; the web client posts it as a
    //    separate request to /transactions/:id/schedule. Plan kinds DO create
    //    their TransactionPlan + pre-generated occurrences here (6.19) — a plan
    //    parent without its rows would be a broken invariant. The generous
    //    timeout covers up-to-600-row pre-generation on slow CI runners.
    const created = await this.prisma.$transaction(
      async (tx) => {
        const transaction = await tx.transaction.create({
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
          await createPlanWithinTransaction(tx, transaction, dto.type, dto.plan, planComputed);
        }
        return transaction;
      },
      { timeout: planComputed ? 30_000 : 5_000 },
    );

    // 9. Audit — fire-and-forget.
    void this.writeAudit(userId, created.id, 'TRANSACTION_CREATED', {
      direction: dto.direction,
      type: dto.type,
      amountCents: dto.amountCents,
      currency: dto.currency,
      categoryId: dto.categoryId,
      attributions: dto.attributions,
      ...(planComputed
        ? {
            plan: {
              transactionsCount: dto.plan!.transactionsCount,
              interestRate: dto.plan!.interestRate,
              frequency: dto.plan!.frequency,
              method: planComputed.method,
            },
          }
        : {}),
    });

    this.logger.log(
      `Transaction ${created.id} (${dto.type}, ${dto.direction}) created by user ${userId}`,
    );

    // 10. Serialize + fan out (POST commit). Recipients = creator + all
    // members of any attributed group + every personal-attribution user.
    return this.publishCreated(created as TransactionWithRelations);
  }

  /**
   * Validate the inputs for a receipt-confirmation transaction — a `ONE_TIME`
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
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_CURRENCY,
      });
    }
    const occurredAt = this.parseAndValidateOccurredAt(input.occurredAt);
    const category = await this.loadCategoryOrThrow(userId, input.categoryId);
    this.ensureCategoryDirectionMatches(category, 'OUT');
    await this.validateAttributions(userId, input.attributions);
    return occurredAt;
  }

  /**
   * Create a `ONE_TIME` `OUT` transaction (attributions + an optional document)
   * inside a caller-provided transaction. The receipt-confirm flow owns the
   * transaction so the transaction, its `TransactionDocument`, and the receipt→transaction
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
      /** One entry per stored receipt page (8.22); empty for url receipts. */
      documents?: {
        kind: string;
        fileRef: string;
        originalName: string | null;
        mimeType: string | null;
        sizeBytes: number | null;
      }[];
    },
  ): Promise<TransactionWithRelations> {
    const transaction = await tx.transaction.create({
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
        ...(input.documents && input.documents.length > 0
          ? {
              documents: {
                create: input.documents.map((doc) => ({
                  kind: doc.kind,
                  fileRef: doc.fileRef,
                  originalName: doc.originalName,
                  mimeType: doc.mimeType,
                  sizeBytes: doc.sizeBytes,
                  uploadedById: userId,
                })),
              },
            }
          : {}),
      },
      include: {
        category: { select: { id: true, slug: true, name: true, icon: true, color: true } },
        attributions: { include: { group: { select: { name: true } } } },
      },
    });
    return transaction as TransactionWithRelations;
  }

  /**
   * Serialize a freshly-created transaction and fan out `transaction.created` to its
   * recipients (creator + every personal-attribution user + all members of
   * any attributed group). Shared by create() and the receipt-confirm flow.
   * Returns the summary so callers can use it as their response body.
   */
  async publishCreated(transaction: TransactionWithRelations): Promise<TransactionSummaryDto> {
    const summary = mapTransactionToSummary(transaction, { starredByMe: false });
    const recipients = await computeTransactionRecipients(
      this.prisma,
      transaction.attributions as RecipientAttribution[],
      transaction.createdById,
    );
    this.eventBus.publish({
      type: 'transaction.created',
      userIds: recipients,
      transaction: summary,
    });
    return summary;
  }

  /**
   * List transactions visible to `userId`, honoring the scope / filter / sort / cursor query.
   *
   * Visibility (design §5.2): a transaction is visible iff at least one of its
   * attributions is personal to the caller OR targets a group the caller is a
   * member of. Expressed as a single `attributions.some` OR in Prisma so the
   * DB handles it in one query (no N+1).
   */
  async list(userId: string, q: ListTransactionsQueryDto): Promise<TransactionListResponseDto> {
    const sort = q.sort ?? 'date_desc';
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);

    // ── 1. Visibility predicate + scope narrowing ──
    const scopeRaw = q.scope ?? 'all';
    let visibilityClause: Prisma.TransactionWhereInput;

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
          errorCode: TRANSACTION_ERRORS.TRANSACTION_SCOPE_NOT_ACCESSIBLE,
        });
      }
      visibilityClause = {
        attributions: { some: { scopeType: 'group', groupId } },
      };
    } else {
      // 'all' (default) — shared helper with findByIdForUser / update.
      visibilityClause = this.buildVisibilityWhere(userId);
    }

    const andClauses: Prisma.TransactionWhereInput[] = [visibilityClause];

    // ── 2. Simple column filters ──
    if (q.direction) andClauses.push({ direction: q.direction });
    if (q.categoryId) andClauses.push({ categoryId: q.categoryId });
    if (q.type) andClauses.push({ type: q.type });

    // ── 2a. Recurring-occurrences filters (iteration 6.18.1.3) ──
    //
    // `parentTransactionId` narrows to the children of a single parent. We
    // enforce visibility on the **parent** before listing — without this,
    // a non-member could enumerate child ids by guessing a parent uuid.
    // Fail closed with the same `TRANSACTION_NOT_FOUND` code findByIdForUser
    // uses, preserving the no-existence-leak rule.
    if (q.parentTransactionId) {
      await this.assertVisible(userId, q.parentTransactionId);
      andClauses.push({ parentTransactionId: q.parentTransactionId });
    }

    // `withParent=true` → only parents (no parentTransactionId).
    // `withParent=false` → only occurrences (parentTransactionId !== null).
    if (q.withParent === 'true') {
      andClauses.push({ parentTransactionId: null });
    } else if (q.withParent === 'false') {
      andClauses.push({ parentTransactionId: { not: null } });
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
          errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_CURSOR,
        });
      }
      andClauses.push(buildCursorGuard(cursorPayload, sort));
    }

    // ── 4. Sort ──
    const orderBy = buildOrderBy(sort);

    // ── 5. Execute ──
    const rows = await this.prisma.transaction.findMany({
      where: { AND: andClauses },
      orderBy,
      take: limit + 1,
      include: buildDetailInclude(userId),
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const data = slice.map((p) =>
      mapTransactionToSummary(p as unknown as TransactionWithRelations, {
        starredByMe: p.stars.length > 0,
        commentCount: p._count.comments,
        hasDocuments: p._count.documents > 0,
      }),
    );

    const nextCursor = hasMore ? encodeCursor(buildCursorFor(slice[slice.length - 1], sort)) : null;

    return { data, nextCursor, hasMore };
  }

  /**
   * Get a single transaction visible to `userId`. Returns 404 when the row either
   * does not exist OR the user lacks a visibility attribution — the design rule
   * is "don't leak existence" (design §5.2, §5.7).
   */
  async findByIdForUser(userId: string, transactionId: string): Promise<TransactionSummaryDto> {
    const row = await this.prisma.transaction.findFirst({
      where: { AND: [{ id: transactionId }, this.buildVisibilityWhere(userId)] },
      include: buildDetailInclude(userId),
    });

    if (!row) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }

    return mapTransactionToSummary(row as unknown as TransactionWithRelations, {
      starredByMe: row.stars.length > 0,
      commentCount: row._count.comments,
      hasDocuments: row._count.documents > 0,
    });
  }

  /**
   * Update scalar fields and/or replace the caller-accessible attribution
   * subset on an existing transaction. Creator only.
   *
   * Returns the fresh summary, or `null` when the caller emptied the
   * accessible attribution set and that left the transaction with zero rows
   * (hard-deleted → controller emits 204).
   *
   * Design §2.4 / §5.2 (iteration 6.8).
   */
  async update(
    userId: string,
    transactionId: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionSummaryDto | null> {
    // 1. Fetch with visibility guard — 404 when not visible or missing.
    const existing = await this.prisma.transaction.findFirst({
      where: { AND: [{ id: transactionId }, this.buildVisibilityWhere(userId)] },
      include: buildDetailInclude(userId),
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }

    // 2. Creator check.
    if (existing.createdById !== userId) {
      throw new ForbiddenException({
        message: 'Only the creator of a transaction may edit it',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_OWNER,
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
      return mapTransactionToSummary(existing as unknown as TransactionWithRelations, {
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
    if (existing.parentTransactionId !== null || (existing.type !== 'ONE_TIME' && !isTypeChange)) {
      throw new BadRequestException({
        message:
          'Generated occurrences / schedule-derived transactions cannot be edited via this endpoint',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_CANNOT_EDIT_GENERATED_OCCURRENCE,
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
          errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_CURRENCY,
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
      // the transaction; we intentionally don't reuse it as the validator cache.)
      const { accessible } = await this.resolveAccessibleAttributions(userId, existingAttrs);

      // Validate desired (non-empty validation is skipped — empty means "clear").
      // Note: we intentionally let `validateAttributions` fetch its own membership
      // set, because `memberGroups` here only contains groups already on the
      // transaction; desired may reference a brand-new group the caller is a member
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

      // Adds: desired entries not already on the transaction (any attribution).
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
          // Present on transaction but NOT accessible (other user's personal).
          // Caller cannot "add" something they couldn't also delete.
          throw new ForbiddenException({
            message: 'Desired attribution collides with a non-accessible existing attribution',
            errorCode: TRANSACTION_ERRORS.TRANSACTION_ATTRIBUTION_OUT_OF_SCOPE,
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
    const data: Prisma.TransactionUpdateInput = {};
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
        await tx.transaction.update({ where: { id: transactionId }, data });
      }
      if (cascadeOnTypeChange) {
        const cascade = await removeScheduleForTransaction(this.prisma, this.queue, transactionId, {
          tx,
          reason: 'parent_type_changed',
          actorId: userId,
        });
        cascadeRemovedScheduleId = cascade.scheduleId;
      }

      let transactionDeleted = false;
      if (attrDiff) {
        if (attrDiff.toDelete.length > 0) {
          await tx.transactionAttribution.deleteMany({
            where: { id: { in: attrDiff.toDelete.map((a) => a.id) } },
          });
        }
        if (attrDiff.toAdd.length > 0) {
          await tx.transactionAttribution.createMany({
            data: attrDiff.toAdd.map((a) => ({
              transactionId,
              scopeType: a.scopeType,
              userId: a.userId,
              groupId: a.groupId,
            })),
          });
        }
        const remaining = await tx.transactionAttribution.count({ where: { transactionId } });
        if (remaining === 0) {
          await tx.transaction.delete({ where: { id: transactionId } });
          transactionDeleted = true;
        }
      }

      return { transactionDeleted };
    });

    // Post-commit queue tear-down for the cascade tear-down path. Failure
    // is logged + swallowed; the worker's self-heal path picks up any
    // orphan scheduler key on its next firing.
    if (cascadeRemovedScheduleId !== null) {
      const schedulerId = `transaction-schedule:${cascadeRemovedScheduleId}`;
      try {
        await this.queue.removeJobScheduler(schedulerId);
      } catch (err) {
        this.logger.warn(
          `cascade removeJobScheduler(${schedulerId}) failed for transaction ${transactionId}: ${(err as Error).message} — worker will self-heal`,
        );
      }
    }

    // 13. Audit — fire-and-forget.
    if (hasScalarField) {
      const changed = Object.keys(dto)
        .filter((k) => k !== 'attributions' && (dto as Record<string, unknown>)[k] !== undefined)
        .sort();
      void this.writeAudit(userId, transactionId, 'TRANSACTION_UPDATED', { changed });
    }
    if (attrDiff) {
      for (const removed of attrDiff.removedForAudit) {
        void this.writeAudit(userId, transactionId, 'TRANSACTION_ATTRIBUTION_REMOVED', {
          scope: removed.scope,
          groupId: removed.groupId ?? null,
        });
      }
      for (const added of attrDiff.addedForAudit) {
        void this.writeAudit(userId, transactionId, 'TRANSACTION_ATTRIBUTION_ADDED', {
          scope: added.scope,
          groupId: added.groupId ?? null,
        });
      }
      if (txResult.transactionDeleted) {
        void this.writeAudit(userId, transactionId, 'TRANSACTION_DELETED', {
          reason: 'attributions_empty',
        });
      }
    }

    this.logger.log(
      `Transaction ${transactionId} updated by user ${userId} — scalars=${hasScalarField}, attrDiff=${attrDiff ? `+${attrDiff.toAdd.length}/-${attrDiff.toDelete.length}` : 'none'}, deleted=${txResult.transactionDeleted}`,
    );

    // 14. Realtime fan-out — POST commit.
    //
    // For attribution events we union pre + post recipients so a user who
    // *lost* visibility still gets a chance to drop the row from their
    // local list. The transaction-level events (updated / deleted) follow the
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
    const recipients = await computeTransactionRecipients(
      this.prisma,
      unionAttrs,
      existing.createdById,
    );

    if (txResult.transactionDeleted) {
      this.eventBus.publish({
        type: 'transaction.deleted',
        userIds: recipients,
        transactionId,
      });
    }
    if (attrDiff) {
      for (const removed of attrDiff.removedForAudit) {
        this.eventBus.publish({
          type: 'transaction_attribution.removed',
          userIds: recipients,
          transactionId,
          scope: removed.scope,
          ...(removed.scope === 'personal' ? { userId } : {}),
          ...(removed.groupId ? { groupId: removed.groupId } : {}),
        });
      }
      for (const added of attrDiff.addedForAudit) {
        this.eventBus.publish({
          type: 'transaction_attribution.added',
          userIds: recipients,
          transactionId,
          scope: added.scope,
          ...(added.scope === 'personal' ? { userId } : {}),
          ...(added.groupId ? { groupId: added.groupId } : {}),
        });
      }
    }

    // 15. Return.
    if (txResult.transactionDeleted) return null;

    const fresh = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: buildDetailInclude(userId),
    });
    if (!fresh) return null; // defensive; shouldn't happen
    const freshSummary = mapTransactionToSummary(fresh as unknown as TransactionWithRelations, {
      starredByMe: fresh.stars.length > 0,
      commentCount: fresh._count.comments,
      hasDocuments: fresh._count.documents > 0,
    });

    // Emit transaction.updated whenever any scalar OR attribution change actually
    // landed. The frontend treats it as a patch-in-place so emitting on
    // attribution-only edits keeps every viewer's row in sync without
    // needing them to also listen to the per-attribution events.
    if (
      hasScalarField ||
      (attrDiff && (attrDiff.toAdd.length > 0 || attrDiff.toDelete.length > 0))
    ) {
      this.eventBus.publish({
        type: 'transaction.updated',
        userIds: recipients,
        transaction: freshSummary,
      });
    }

    return freshSummary;
  }

  /**
   * Edit a transaction's non-period fields and (optionally) cascade the same
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
   * transaction; realtime `transaction.updated` events fan out AFTER commit.
   */
  async editTransactionWithPropagation(
    userId: string,
    transactionId: string,
    dto: UpdateTransactionDto,
    propagate: TransactionPropagateMode,
  ): Promise<CascadeEditResponseDto> {
    // 1. Fetch parent with visibility guard.
    const existing = await this.prisma.transaction.findFirst({
      where: { AND: [{ id: transactionId }, this.buildVisibilityWhere(userId)] },
      include: buildDetailInclude(userId),
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }

    // 2. Creator check.
    if (existing.createdById !== userId) {
      throw new ForbiddenException({
        message: 'Only the creator of a transaction may edit it',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_OWNER,
      });
    }

    // 3. Edit eligibility — must be an editable parent (ONE_TIME / RECURRING),
    //    never a generated occurrence.
    if (
      existing.parentTransactionId !== null ||
      (existing.type !== 'ONE_TIME' && existing.type !== 'RECURRING')
    ) {
      throw new BadRequestException({
        message:
          'Generated occurrences / schedule-derived transactions cannot be edited via this endpoint',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_CANNOT_EDIT_GENERATED_OCCURRENCE,
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
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_CURRENCY,
      });
    }

    // 6. Validate desired attributions (non-empty, in editor scope).
    const desired = dto.attributions ?? [];
    if (hasAttributionField) {
      await this.validateAttributions(userId, desired);
    }

    // 7. Build the reusable scalar delta payload (parent + each child).
    const scalarData: Prisma.TransactionUpdateInput = {};
    if (dto.direction !== undefined) scalarData.direction = dto.direction;
    if (dto.amountCents !== undefined) scalarData.amountCents = dto.amountCents;
    if (dto.currency !== undefined) scalarData.currency = dto.currency;
    if (categoryChanging) scalarData.category = { connect: { id: nextCategoryId } };
    if (dto.note !== undefined) scalarData.note = dto.note === '' ? null : dto.note;

    // Nothing to do — return the current parent summary with zero counts.
    if (!hasScalarField && !hasAttributionField) {
      return {
        transaction: mapTransactionToSummary(existing as unknown as TransactionWithRelations, {
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
      ? await this.prisma.transaction.findMany({
          where: {
            parentTransactionId: transactionId,
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
      await this.applyFieldDeltas(tx, transactionId, existingAttrs, scalarData, attrPlanFor);
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

    // 13. Audit — fire-and-forget, one row per affected transaction.
    const changed = Object.keys(dto)
      .filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
      .sort();
    void this.writeAudit(userId, transactionId, 'TRANSACTION_UPDATED', { changed, propagate });
    for (const c of controllableChildren) {
      void this.writeAudit(userId, c.id, 'TRANSACTION_UPDATED', {
        changed,
        propagate,
        cascadedFrom: transactionId,
      });
    }

    this.logger.log(
      `Transaction ${transactionId} cascade-edited by ${userId} — propagate=${propagate}, ` +
        `children affected=${controllableChildren.length}, skipped=${skippedChildrenCount}`,
    );

    // 14. Realtime fan-out — POST commit. One transaction.updated per affected
    //     transaction, each with its own multicast recipients (union pre + post
    //     attributions so users who lost visibility can drop the row).
    const parentFresh = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: buildDetailInclude(userId),
    });
    let parentSummary: TransactionSummaryDto;
    if (parentFresh) {
      parentSummary = mapTransactionToSummary(parentFresh as unknown as TransactionWithRelations, {
        starredByMe: parentFresh.stars.length > 0,
        commentCount: parentFresh._count.comments,
        hasDocuments: parentFresh._count.documents > 0,
      });
      const parentRecipients = await computeTransactionRecipients(
        this.prisma,
        unionAttributions(existingAttrs, attrPlanFor ? attrPlanFor(existingAttrs).postAttrs : null),
        existing.createdById,
      );
      this.eventBus.publish({
        type: 'transaction.updated',
        userIds: parentRecipients,
        transaction: parentSummary,
      });
    } else {
      // Defensive — shouldn't happen since we only update, never delete here.
      parentSummary = mapTransactionToSummary(existing as unknown as TransactionWithRelations, {
        starredByMe: existing.stars.length > 0,
        commentCount: existing._count.comments,
        hasDocuments: existing._count.documents > 0,
      });
    }

    for (const c of controllableChildren) {
      const childFresh = await this.prisma.transaction.findUnique({
        where: { id: c.id },
        include: buildDetailInclude(userId),
      });
      if (!childFresh) continue;
      const childSummary = mapTransactionToSummary(
        childFresh as unknown as TransactionWithRelations,
        {
          starredByMe: childFresh.stars.length > 0,
          commentCount: childFresh._count.comments,
          hasDocuments: childFresh._count.documents > 0,
        },
      );
      const childAttrs = c.attributions as unknown as AttributionRow[];
      const recipients = await computeTransactionRecipients(
        this.prisma,
        unionAttributions(childAttrs, attrPlanFor ? attrPlanFor(childAttrs).postAttrs : null),
        childFresh.createdById,
      );
      this.eventBus.publish({
        type: 'transaction.updated',
        userIds: recipients,
        transaction: childSummary,
      });
    }

    return {
      transaction: parentSummary,
      affectedChildrenCount: controllableChildren.length,
      skippedChildrenCount,
    };
  }

  /**
   * Apply a non-period field delta to a single transaction inside a transaction.
   * Reused for the parent and every controllable child (DRY — Phase 6 ·
   * Iteration 6.18.1.5). Scalars are a plain update; attributions replace the
   * editor-controllable subset with `desired`, preserving any out-of-scope
   * attribution the editor cannot control.
   */
  private async applyFieldDeltas(
    tx: Prisma.TransactionClient,
    targetId: string,
    targetAttrs: AttributionRow[],
    scalarData: Prisma.TransactionUpdateInput,
    attrPlanFor: ((attrs: AttributionRow[]) => ReturnType<typeof planAttributionReplace>) | null,
  ): Promise<void> {
    if (Object.keys(scalarData).length > 0) {
      await tx.transaction.update({ where: { id: targetId }, data: scalarData });
    }
    if (attrPlanFor) {
      const plan = attrPlanFor(targetAttrs);
      if (plan.toDeleteIds.length > 0) {
        await tx.transactionAttribution.deleteMany({ where: { id: { in: plan.toDeleteIds } } });
      }
      if (plan.toCreate.length > 0) {
        await tx.transactionAttribution.createMany({
          data: plan.toCreate.map((a) => ({
            transactionId: targetId,
            scopeType: a.scopeType,
            userId: a.userId,
            groupId: a.groupId,
          })),
        });
      }
    }
  }

  /**
   * Scoped-delete (DELETE /transactions/:id). See design §2.4 + §5.2.
   *
   * The `scope` query narrows what is removed. When the caller ends up with
   * zero attributions on the transaction, the Transaction row is hard-deleted and
   * cascades clean up stars / comments / documents / schedule / plan
   * (onDelete: Cascade declared in the schema from iteration 6.2).
   */
  async remove(
    userId: string,
    transactionId: string,
    query: DeleteTransactionQueryDto,
  ): Promise<AttributionChangeResultDto> {
    // 1. Fetch the transaction (raw — visibility is enforced via accessible set below).
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { attributions: true },
    });
    if (!transaction) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }

    const existingAttrs = transaction.attributions as unknown as AttributionRow[];

    // 2. Resolve caller-accessible attributions.
    const { accessible, personal, memberGroups } = await this.resolveAccessibleAttributions(
      userId,
      existingAttrs,
    );
    if (accessible.length === 0) {
      // Caller can't see this transaction → 404 (don't leak existence).
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
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
          errorCode: TRANSACTION_ERRORS.TRANSACTION_SCOPE_AMBIGUOUS,
          details: { accessibleScopes },
        });
      }
    } else if (scope === 'personal') {
      if (!personal) {
        throw new ConflictException({
          message: 'Caller has no personal attribution on this transaction',
          errorCode: TRANSACTION_ERRORS.TRANSACTION_SCOPE_NOT_ATTRIBUTED,
        });
      }
      targets = [personal];
    } else if (scope === 'all') {
      if (accessible.length === 0) {
        throw new ConflictException({
          message: 'No accessible attributions to remove',
          errorCode: TRANSACTION_ERRORS.TRANSACTION_NO_ACCESSIBLE_ATTRIBUTION,
        });
      }
      targets = accessible.slice();
    } else if (scope.startsWith('group:')) {
      const gid = scope.slice('group:'.length);
      if (!memberGroups.has(gid)) {
        // Non-member for that group → still 409 NOT_ATTRIBUTED (404-on-entity rule
        // only applies when the *transaction* is non-visible).
        throw new ConflictException({
          message: `Caller has no accessible attribution with scope group:${gid} on this transaction`,
          errorCode: TRANSACTION_ERRORS.TRANSACTION_SCOPE_NOT_ATTRIBUTED,
        });
      }
      const match = accessible.find((a) => a.scopeType === 'group' && a.groupId === gid);
      if (!match) {
        throw new ConflictException({
          message: `Caller has no accessible attribution with scope group:${gid} on this transaction`,
          errorCode: TRANSACTION_ERRORS.TRANSACTION_SCOPE_NOT_ATTRIBUTED,
        });
      }
      targets = [match];
    } else {
      // DTO regex should have caught this; defensively treat as ambiguous.
      throw new ConflictException({
        message: `Invalid scope '${scope}'`,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_SCOPE_AMBIGUOUS,
      });
    }

    const targetIds = targets.map((t) => t.id);

    // 4. Transactional delete. On the final hard-delete branch we cascade
    // the schedule (DB row + audit) BEFORE the parent row goes away. The
    // BullMQ scheduler key is removed AFTER the tx commits — Redis I/O
    // inside a SQL transaction triggers MySQL deadlocks under concurrent
    // load. Worker self-heal covers any divergence if Redis is down.
    let cascadeRemovedScheduleId: string | null = null;
    const { transactionDeleted } = await this.prisma.$transaction(async (tx) => {
      await tx.transactionAttribution.deleteMany({ where: { id: { in: targetIds } } });
      const remaining = await tx.transactionAttribution.count({ where: { transactionId } });
      let hardDeleted = false;
      if (remaining === 0) {
        const cascade = await removeScheduleForTransaction(this.prisma, this.queue, transactionId, {
          tx,
          reason: 'parent_deleted',
          actorId: userId,
        });
        cascadeRemovedScheduleId = cascade.scheduleId;
        await tx.transaction.delete({ where: { id: transactionId } });
        hardDeleted = true;
      }
      return { transactionDeleted: hardDeleted };
    });

    if (cascadeRemovedScheduleId !== null) {
      const schedulerId = `transaction-schedule:${cascadeRemovedScheduleId}`;
      try {
        await this.queue.removeJobScheduler(schedulerId);
      } catch (err) {
        this.logger.warn(
          `cascade removeJobScheduler(${schedulerId}) failed for transaction ${transactionId}: ${(err as Error).message} — worker will self-heal`,
        );
      }
    }

    // 5. Audit (best-effort).
    for (const t of targets) {
      void this.writeAudit(userId, transactionId, 'TRANSACTION_ATTRIBUTION_REMOVED', {
        scope: t.scopeType,
        groupId: t.groupId ?? null,
      });
    }
    if (transactionDeleted) {
      void this.writeAudit(userId, transactionId, 'TRANSACTION_DELETED', {
        reason: 'scope_delete',
        scope: scope ?? 'implicit',
      });
    }

    this.logger.log(
      `Transaction ${transactionId} scoped-delete by user ${userId} — targets=${targetIds.length}, transactionDeleted=${transactionDeleted}`,
    );

    // 6. Assemble response.
    let summary: TransactionSummaryDto | null = null;
    if (!transactionDeleted) {
      const fresh = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        include: buildDetailInclude(userId),
      });
      if (fresh) {
        summary = mapTransactionToSummary(fresh as unknown as TransactionWithRelations, {
          starredByMe: fresh.stars.length > 0,
          commentCount: fresh._count.comments,
          hasDocuments: fresh._count.documents > 0,
        });
      }
    }

    // 7. Realtime fan-out — POST commit. Recipients = pre-delete viewers
    // (so users who lost visibility still receive the removal event and
    // can drop the row from their local lists).
    const recipients = await computeTransactionRecipients(
      this.prisma,
      existingAttrs.map((a) => ({
        scopeType: a.scopeType,
        userId: a.userId,
        groupId: a.groupId,
      })),
      transaction.createdById,
    );
    if (transactionDeleted) {
      this.eventBus.publish({
        type: 'transaction.deleted',
        userIds: recipients,
        transactionId,
      });
    } else {
      for (const t of targets) {
        this.eventBus.publish({
          type: 'transaction_attribution.removed',
          userIds: recipients,
          transactionId,
          scope: t.scopeType as 'personal' | 'group',
          ...(t.scopeType === 'personal' && t.userId ? { userId: t.userId } : {}),
          ...(t.groupId ? { groupId: t.groupId } : {}),
        });
      }
      if (summary) {
        this.eventBus.publish({
          type: 'transaction.updated',
          userIds: recipients,
          transaction: summary,
        });
      }
    }

    return {
      deletedAttributions: targetIds.length,
      addedAttributions: 0,
      transactionDeleted,
      transaction: summary,
    };
  }

  // ── helpers ──

  private validateAmount(amountCents: number): void {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BadRequestException({
        message: 'amountCents must be a positive integer',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_AMOUNT,
      });
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      throw new BadRequestException({
        message: 'amountCents exceeds the maximum allowed value',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_AMOUNT,
      });
    }
  }

  private parseAndValidateOccurredAt(iso: string): Date {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({
        message: 'occurredAt is not a valid ISO 8601 date',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_DATE,
      });
    }
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (d.getTime() > Date.now() + oneDayMs) {
      throw new BadRequestException({
        message: 'occurredAt cannot be in the future',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_DATE,
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
        errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_CATEGORY,
      });
    }
  }

  private ensureCategoryDirectionMatches(
    category: { direction: string },
    direction: 'IN' | 'OUT',
  ): void {
    if (category.direction !== 'BOTH' && category.direction !== direction) {
      throw new BadRequestException({
        message: `Category direction '${category.direction}' does not accept transactions of direction '${direction}'`,
        errorCode: TRANSACTION_ERRORS.TRANSACTION_CATEGORY_DIRECTION_MISMATCH,
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
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NO_ATTRIBUTIONS,
      });
    }

    const seen = new Set<string>();
    const groupIdsToCheck = new Set<string>();

    for (const a of attributions) {
      if (a.scope === 'personal') {
        if (a.groupId !== undefined && a.groupId !== null) {
          throw new BadRequestException({
            message: 'personal attributions must not carry a groupId',
            errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_ATTRIBUTION,
          });
        }
      } else if (a.scope === 'group') {
        if (!a.groupId) {
          throw new BadRequestException({
            message: 'group attributions require a groupId',
            errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_ATTRIBUTION,
          });
        }
        groupIdsToCheck.add(a.groupId);
      } else {
        throw new BadRequestException({
          message: `Unknown attribution scope '${(a as { scope: string }).scope}'`,
          errorCode: TRANSACTION_ERRORS.TRANSACTION_INVALID_ATTRIBUTION,
        });
      }

      const key = `${a.scope}|${a.groupId ?? ''}`;
      if (seen.has(key)) {
        throw new BadRequestException({
          message: 'Duplicate attributions are not allowed',
          errorCode: TRANSACTION_ERRORS.TRANSACTION_DUPLICATE_ATTRIBUTION,
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
            errorCode: TRANSACTION_ERRORS.TRANSACTION_ATTRIBUTION_OUT_OF_SCOPE,
          });
        }
      }
    }
  }

  /**
   * Partition a transaction's attribution rows into the subset the caller can
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
    const groupIdsOnTransaction = Array.from(
      new Set(
        attributions
          .filter((a) => a.scopeType === 'group' && a.groupId)
          .map((a) => a.groupId as string),
      ),
    );
    let memberGroups = new Set<string>();
    if (groupIdsOnTransaction.length > 0) {
      const memberships = await this.prisma.groupMembership.findMany({
        where: { userId, groupId: { in: groupIdsOnTransaction } },
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
   * Toggle the caller's `TransactionStar` row for a transaction (iteration 6.9).
   *
   * Gated by the shared visibility predicate — 404 when the caller cannot see
   * the transaction (no existence leak). Create vs. delete runs inside a single
   * `$transaction` so concurrent double-taps can't duplicate rows or leave
   * the row set inconsistent.
   */
  async toggleStar(userId: string, transactionId: string): Promise<ToggleStarResponseDto> {
    // 1. Visibility check — lightweight, just need the id.
    const visible = await this.prisma.transaction.findFirst({
      where: { AND: [{ id: transactionId }, this.buildVisibilityWhere(userId)] },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }

    // 2. Toggle atomically. Compound unique is `transactionId_userId`.
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transactionStar.findUnique({
        where: { transactionId_userId: { transactionId, userId } },
      });
      if (existing) {
        await tx.transactionStar.delete({ where: { id: existing.id } });
        return { starred: false };
      }
      await tx.transactionStar.create({ data: { transactionId, userId } });
      return { starred: true };
    });

    // 3. Cheap aggregate for the response.
    const starCount = await this.prisma.transactionStar.count({ where: { transactionId } });

    // 4. Audit — fire-and-forget, don't break the request on audit failure.
    void this.writeAudit(
      userId,
      transactionId,
      result.starred ? 'TRANSACTION_STARRED' : 'TRANSACTION_UNSTARRED',
      {},
    );

    this.logger.log(
      `Transaction ${transactionId} star toggled by user ${userId} → starred=${result.starred}, total=${starCount}`,
    );

    return { starred: result.starred, starCount };
  }

  private async writeAudit(
    userId: string,
    transactionId: string,
    action:
      | 'TRANSACTION_CREATED'
      | 'TRANSACTION_UPDATED'
      | 'TRANSACTION_DELETED'
      | 'TRANSACTION_ATTRIBUTION_ADDED'
      | 'TRANSACTION_ATTRIBUTION_REMOVED'
      | 'TRANSACTION_STARRED'
      | 'TRANSACTION_UNSTARRED',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Transaction',
          entityId: transactionId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action} ${transactionId}: ${(err as Error).message}`,
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
 * Compute the attribution replacement plan for one transaction: delete the
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

export function buildOrderBy(sort: SortKey): Prisma.TransactionOrderByWithRelationInput[] {
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
export function buildCursorGuard(cursor: Cursor, sort: SortKey): Prisma.TransactionWhereInput {
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
