import {
  decodeCursor,
  encodeCursor,
  TRANSFER_CATEGORY_SLUG,
  type StatementLineStatus,
} from '@myfinpro/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../realtime/event-bus.service';
import { TRANSACTION_ERRORS } from '../transaction/constants/transaction-errors';
import { AttributionDto } from '../transaction/dto/attribution.dto';
import {
  TransactionCategorySummary,
  TransactionSummaryDto,
} from '../transaction/dto/transaction-summary.dto';
import {
  buildDetailInclude,
  CATEGORY_SUMMARY_SELECT,
  mapTransactionToSummary,
  TransactionService,
  type TransactionWithRelations,
} from '../transaction/transaction.service';
import { buildTransactionVisibilityWhere } from '../transaction/utils/transaction-visibility';
import { categoryVisibilityClauses } from '../category/utils/category-visibility';
import { AccountService } from './account.service';
import { ACCOUNT_ERRORS } from './constants/account-errors';
import { ApplySuggestionsDto, ApplySuggestionsResultDto } from './dto/apply-suggestions.dto';
import { CreateFromLineDto } from './dto/create-from-line.dto';
import { ListLinesQueryDto, type StatementSuggestionFilter } from './dto/list-lines-query.dto';
import { MatchLineDto } from './dto/match-line.dto';
import {
  StatementLineDecisionResponseDto,
  StatementLineListResponseDto,
  StatementLineResponseDto,
} from './dto/statement-line-response.dto';
import { StatementSuggestionDto } from './dto/statement-suggestion.dto';
import { TransferLineDto } from './dto/transfer-line.dto';
import { matchesLineShape, type SuggestionSnapshot } from './matching/statement-matcher';
import { publishAccountUpdated, writeAccountAudit } from './utils/account-side-effects';

type AccountRow = Prisma.AccountGetPayload<Record<string, never>>;
type LineRow = Prisma.AccountStatementLineGetPayload<Record<string, never>>;

/** Note length of `CreateTransactionDto` — a description never exceeds it. */
const NOTE_MAX_LENGTH = 2000;

/**
 * Lines one "apply all" call may decide. Each applied line writes a
 * transaction through `TransactionService`, so the run has to stay a
 * request-sized unit of work; the response says how many are left and the
 * client calls again (security review L4).
 */
export const APPLY_SUGGESTIONS_BATCH_SIZE = 200;

/** The statuses a transaction may have for a bank line to settle it (§5.1). */
const MATCHABLE_TRANSACTION_STATUSES = ['POSTED', 'PENDING', 'DUE'];

/**
 * Phase 20 · Iteration 20.4 — the review queue (design §2.5, §5.5, §6.2).
 *
 * Every decision is resumable and reversible: a line is `PENDING` until the
 * user (or "apply all") decides it, and `DELETE …/link` puts it back without
 * touching the transaction. Transactions are created and enriched ONLY
 * through `TransactionService`, so category, attribution and currency
 * validation, the audit trail and the realtime events stay in one place.
 */
@Injectable()
export class StatementLineService {
  private readonly logger = new Logger(StatementLineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly transactions: TransactionService,
    private readonly eventBus: EventBus,
  ) {}

  // ── read ──

  /**
   * The review queue: an account's lines, newest posting first, filterable by
   * status, import and — pagination-safe, in SQL — by what the matcher
   * proposed (design §6.2).
   */
  async list(
    userId: string,
    accountId: string,
    query: ListLinesQueryDto,
  ): Promise<StatementLineListResponseDto> {
    await this.accounts.loadForRead(userId, accountId);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

    const filters: Prisma.AccountStatementLineWhereInput[] = [{ accountId }];
    if (query.status) filters.push({ status: query.status });
    if (query.importId) filters.push({ importId: query.importId });
    if (query.suggestion) filters.push(suggestionFilter(query.suggestion));

    if (query.cursor) {
      let postedAt: Date;
      let id: string;
      try {
        const decoded = decodeCursor(query.cursor);
        postedAt = new Date(decoded.postedAt as string);
        id = decoded.id as string;
        if (Number.isNaN(postedAt.getTime()) || typeof id !== 'string') {
          throw new Error('bad cursor');
        }
      } catch {
        throw new BadRequestException({ message: 'Invalid cursor' });
      }
      filters.push({ OR: [{ postedAt: { lt: postedAt } }, { postedAt, id: { lt: id } }] });
    }

    const rows = await this.prisma.accountStatementLine.findMany({
      where: { AND: filters },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      data: await this.mapLines(userId, page),
      nextCursor:
        hasMore && last
          ? encodeCursor({ postedAt: last.postedAt.toISOString(), id: last.id })
          : null,
      hasMore,
    };
  }

  // ── decisions ──

  /** Link a line to a transaction that already existed (design §5.5). */
  async match(
    userId: string,
    accountId: string,
    lineId: string,
    dto: MatchLineDto,
  ): Promise<StatementLineDecisionResponseDto> {
    const account = await this.loadAccountForDecision(userId, accountId);
    const line = await this.loadPendingLine(accountId, lineId);
    return this.applyMatch(userId, account, line, dto.transactionId);
  }

  /** Create a new transaction from a line the app had never recorded. */
  async createFromLine(
    userId: string,
    accountId: string,
    lineId: string,
    dto: CreateFromLineDto,
  ): Promise<StatementLineDecisionResponseDto> {
    const account = await this.loadAccountForDecision(userId, accountId);
    const line = await this.loadPendingLine(accountId, lineId);
    return this.applyCreate(userId, account, line, dto);
  }

  /** Record the line as money moving between two of the user's own accounts. */
  async transferFromLine(
    userId: string,
    accountId: string,
    lineId: string,
    dto: TransferLineDto,
  ): Promise<StatementLineDecisionResponseDto> {
    const account = await this.loadAccountForDecision(userId, accountId);
    const line = await this.loadPendingLine(accountId, lineId);
    return this.applyTransfer(userId, account, line, dto.transferAccountId);
  }

  /** "Not something I track" — kept for dedup and audit (design §2.5). */
  async ignore(
    userId: string,
    accountId: string,
    lineId: string,
  ): Promise<StatementLineDecisionResponseDto> {
    const account = await this.accounts.loadForRead(userId, accountId);
    const line = await this.loadPendingLine(accountId, lineId);

    const updated = await this.claimLine(userId, line.id, 'IGNORED', null);
    await this.afterDecision(userId, account, updated, 'STATEMENT_LINE_IGNORED', {});
    return { line: (await this.mapLines(userId, [updated]))[0], transaction: null };
  }

  /**
   * Undo: the line goes back to `PENDING` and forgets its transaction. The
   * transaction itself is left exactly as it is — deleting or un-posting it
   * is the user's separate decision (design §2.5). Idempotent.
   */
  async unlink(
    userId: string,
    accountId: string,
    lineId: string,
  ): Promise<StatementLineDecisionResponseDto> {
    const account = await this.accounts.loadForRead(userId, accountId);
    const line = await this.loadLine(accountId, lineId);
    if (line.status === 'PENDING' && line.transactionId === null) {
      return { line: (await this.mapLines(userId, [line]))[0], transaction: null };
    }

    const updated = await this.prisma.accountStatementLine.update({
      where: { id: line.id },
      data: { status: 'PENDING', transactionId: null, decidedAt: null, decidedById: null },
    });
    await this.afterDecision(userId, account, updated, 'STATEMENT_LINE_UNLINKED', {
      previousStatus: line.status,
      previousTransactionId: line.transactionId,
    });
    return { line: (await this.mapLines(userId, [updated]))[0], transaction: null };
  }

  /**
   * Apply every confident suggestion at once (design §6.2): matches,
   * transfers and creates that already carry a remembered category. Anything
   * the matcher was unsure about — and anything that failed meanwhile, e.g. a
   * transaction someone else linked first — is counted as skipped, never
   * forced.
   */
  async applySuggestions(
    userId: string,
    accountId: string,
    dto: ApplySuggestionsDto,
  ): Promise<ApplySuggestionsResultDto> {
    const account = await this.loadAccountForDecision(userId, accountId);

    const where: Prisma.AccountStatementLineWhereInput = {
      accountId,
      status: 'PENDING',
      ...(dto.lineIds ? { id: { in: dto.lineIds } } : {}),
    };
    const [lines, pendingCount] = await Promise.all([
      this.prisma.accountStatementLine.findMany({
        where,
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
        take: APPLY_SUGGESTIONS_BATCH_SIZE,
      }),
      this.prisma.accountStatementLine.count({ where }),
    ]);

    const result: ApplySuggestionsResultDto = {
      matched: 0,
      transferred: 0,
      created: 0,
      skipped: 0,
      remaining: Math.max(pendingCount - lines.length, 0),
    };

    for (const line of lines) {
      const suggestion = readSuggestion(line.suggestion);
      try {
        if (suggestion?.action === 'match' && suggestion.transactionId) {
          await this.applyMatch(userId, account, line, suggestion.transactionId);
          result.matched++;
        } else if (suggestion?.action === 'transfer' && suggestion.transferAccountId) {
          await this.applyTransfer(userId, account, line, suggestion.transferAccountId);
          result.transferred++;
        } else if (suggestion?.action === 'create' && suggestion.categoryId) {
          await this.applyCreate(userId, account, line, { categoryIds: [suggestion.categoryId] });
          result.created++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.skipped++;
        this.logger.warn(
          `apply-suggestions skipped line ${line.id} on account ${accountId}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `apply-suggestions on account ${accountId} by user ${userId}: ${result.matched} matched, ${result.transferred} transferred, ${result.created} created, ${result.skipped} skipped, ${result.remaining} left for the next call`,
    );
    return result;
  }

  // ── decision internals (shared with apply-suggestions) ──

  private async applyMatch(
    userId: string,
    account: AccountRow,
    line: LineRow,
    transactionId: string,
  ): Promise<StatementLineDecisionResponseDto> {
    const candidate = await this.prisma.transaction.findFirst({
      where: { AND: [{ id: transactionId }, buildTransactionVisibilityWhere(userId)] },
      select: {
        id: true,
        type: true,
        status: true,
        direction: true,
        amountCents: true,
        currency: true,
        accountId: true,
        transferAccountId: true,
        statementLine: { select: { id: true } },
      },
    });
    if (!candidate) {
      throw new NotFoundException({
        message: 'Transaction not found',
        errorCode: TRANSACTION_ERRORS.TRANSACTION_NOT_FOUND,
      });
    }
    if (candidate.statementLine) {
      throw new ConflictException({
        message: 'That transaction is already confirmed by another statement line',
        errorCode: ACCOUNT_ERRORS.STATEMENT_LINE_ALREADY_LINKED,
      });
    }
    // Design §5.1: only a plain one-off movement that has not settled
    // elsewhere can be what this bank line records.
    if (
      !matchesLineShape(line, candidate, account.id) ||
      candidate.type !== 'ONE_TIME' ||
      !MATCHABLE_TRANSACTION_STATUSES.includes(candidate.status)
    ) {
      throw new BadRequestException({
        message:
          'The transaction does not record this line: amount, currency, direction, account, ' +
          'type or status differ',
        errorCode: ACCOUNT_ERRORS.STATEMENT_MATCH_INVALID,
      });
    }

    const { line: updated, transaction } = await this.linkLineToTransaction(
      userId,
      account,
      line,
      candidate.id,
    );
    return this.decisionResponse(userId, updated, transaction);
  }

  /**
   * The ONE write path a match takes (design §5.5): claim the line and its
   * 1:1 link, enrich the transaction, audit, fan out. Shared by the manual
   * decision above — which validates the pair first — and by
   * `StatementMatchingService.autoLink`, which found the pair itself; neither
   * may grow a second way to link a line to a transaction.
   *
   * Claiming the line AND the link first, in one conditional write, is what
   * makes it race-safe: two concurrent decisions cannot both pass, and the
   * loser gets a clean conflict instead of a half-applied enrichment
   * (security review M2 / M3). The unique index on `transaction_id` is the
   * fence; `STATEMENT_LINE_NOT_PENDING` / `STATEMENT_LINE_ALREADY_LINKED`
   * are what a loser sees.
   */
  async linkLineToTransaction(
    userId: string,
    account: AccountRow,
    line: LineRow,
    transactionId: string,
  ): Promise<{ line: LineRow; transaction: TransactionSummaryDto }> {
    const updated = await this.claimLine(userId, line.id, 'MATCHED', transactionId);
    let transaction: TransactionSummaryDto;
    try {
      transaction = await this.transactions.confirmByStatementLine(
        userId,
        transactionId,
        account.id,
        line.id,
      );
    } catch (err) {
      await this.releaseClaim(line.id);
      throw err;
    }

    await this.afterDecision(userId, account, updated, 'STATEMENT_LINE_MATCHED', {
      transactionId,
    });
    return { line: updated, transaction };
  }

  private async applyCreate(
    userId: string,
    account: AccountRow,
    line: LineRow,
    dto: CreateFromLineDto,
  ): Promise<StatementLineDecisionResponseDto> {
    // Claim before writing money: whoever loses the race never creates a
    // second transaction for the same bank line (security review M2).
    await this.claimLine(userId, line.id, 'CREATED', null);
    const transaction = await this.createOrRelease(line.id, () =>
      this.transactions.create(userId, {
        direction: line.direction as 'IN' | 'OUT',
        type: 'ONE_TIME',
        amountCents: line.amountCents,
        currency: line.currency,
        occurredAt: (line.valueAt ?? line.postedAt).toISOString(),
        categoryIds: dto.categoryIds,
        note: (dto.note ?? line.description).slice(0, NOTE_MAX_LENGTH),
        attributions: dto.attributions ?? defaultAttributions(account),
        accountId: account.id,
      }),
    );

    const updated = await this.attachTransaction(line.id, transaction.id);
    await this.afterDecision(userId, account, updated, 'STATEMENT_LINE_CREATED', {
      transactionId: transaction.id,
      categoryIds: dto.categoryIds,
    });
    return this.decisionResponse(userId, updated, transaction);
  }

  private async applyTransfer(
    userId: string,
    account: AccountRow,
    line: LineRow,
    otherAccountId: string,
  ): Promise<StatementLineDecisionResponseDto> {
    const transferCategory = await this.prisma.category.findFirst({
      where: { ownerType: 'system', slug: TRANSFER_CATEGORY_SLUG },
      select: { id: true },
    });
    if (!transferCategory) {
      throw new InternalServerErrorException({
        message: `The '${TRANSFER_CATEGORY_SLUG}' system category is missing`,
      });
    }

    // A transfer is always ONE OUT row from the source account. An OUT line
    // pays the other account; an IN line was paid BY it (design §2.4).
    const source = line.direction === 'OUT' ? account.id : otherAccountId;
    const destination = line.direction === 'OUT' ? otherAccountId : account.id;

    await this.claimLine(userId, line.id, 'CREATED', null);
    const transaction = await this.createOrRelease(line.id, () =>
      this.transactions.create(userId, {
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: line.amountCents,
        currency: line.currency,
        occurredAt: (line.valueAt ?? line.postedAt).toISOString(),
        categoryIds: [transferCategory.id],
        note: line.description.slice(0, NOTE_MAX_LENGTH),
        attributions: defaultAttributions(account),
        accountId: source,
        transferAccountId: destination,
      }),
    );

    const updated = await this.attachTransaction(line.id, transaction.id);
    await this.afterDecision(userId, account, updated, 'STATEMENT_LINE_TRANSFERRED', {
      transactionId: transaction.id,
      sourceAccountId: source,
      destinationAccountId: destination,
    });
    return this.decisionResponse(userId, updated, transaction);
  }

  // ── plumbing ──

  /**
   * A decision that writes a transaction needs an active account — an
   * archived one accepts no new placements. `ignore` and `unlink` stay
   * possible so a review queue is never stuck.
   */
  private async loadAccountForDecision(userId: string, accountId: string): Promise<AccountRow> {
    const account = await this.accounts.loadForRead(userId, accountId);
    if (account.archivedAt) {
      throw new ConflictException({
        message: 'Cannot record transactions on an archived account — unarchive it first',
        errorCode: ACCOUNT_ERRORS.ACCOUNT_ARCHIVED,
      });
    }
    return account;
  }

  /** A line is only ever reached through its account (design §9). */
  private async loadLine(accountId: string, lineId: string): Promise<LineRow> {
    const line = await this.prisma.accountStatementLine.findFirst({
      where: { id: lineId, accountId },
    });
    if (!line) {
      throw new NotFoundException({
        message: 'Statement line not found',
        errorCode: ACCOUNT_ERRORS.STATEMENT_LINE_NOT_FOUND,
      });
    }
    return line;
  }

  private async loadPendingLine(accountId: string, lineId: string): Promise<LineRow> {
    const line = await this.loadLine(accountId, lineId);
    if (line.status !== 'PENDING') {
      throw new ConflictException({
        message: 'That line was already decided — unlink it first',
        errorCode: ACCOUNT_ERRORS.STATEMENT_LINE_NOT_PENDING,
      });
    }
    return line;
  }

  /**
   * Take the line out of `PENDING` with a CONDITIONAL write — the row moves
   * only if it is still pending, so two concurrent decisions (two clicks, two
   * "apply all" runs) can never both proceed. The loser sees
   * `STATEMENT_LINE_NOT_PENDING`, and a transaction that was already claimed
   * by another line trips the 1:1 unique index and becomes
   * `STATEMENT_LINE_ALREADY_LINKED` (security review M2 / M3).
   */
  private async claimLine(
    userId: string,
    lineId: string,
    status: StatementLineStatus,
    transactionId: string | null,
  ): Promise<LineRow> {
    let claimed: { count: number };
    try {
      claimed = await this.prisma.accountStatementLine.updateMany({
        where: { id: lineId, status: 'PENDING' },
        data: { status, transactionId, decidedAt: new Date(), decidedById: userId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          message: 'That transaction is already confirmed by another statement line',
          errorCode: ACCOUNT_ERRORS.STATEMENT_LINE_ALREADY_LINKED,
        });
      }
      throw err;
    }
    if (claimed.count === 0) {
      throw new ConflictException({
        message: 'That line was already decided — unlink it first',
        errorCode: ACCOUNT_ERRORS.STATEMENT_LINE_NOT_PENDING,
      });
    }
    return this.loadLineById(lineId);
  }

  /** Give a claim back when the write it was taken for never happened. */
  private async releaseClaim(lineId: string): Promise<void> {
    await this.prisma.accountStatementLine.updateMany({
      where: { id: lineId },
      data: { status: 'PENDING', transactionId: null, decidedAt: null, decidedById: null },
    });
  }

  /** Run the transaction write, releasing the claim if it throws. */
  private async createOrRelease(
    lineId: string,
    write: () => Promise<TransactionSummaryDto>,
  ): Promise<TransactionSummaryDto> {
    try {
      return await write();
    } catch (err) {
      await this.releaseClaim(lineId);
      throw err;
    }
  }

  private async attachTransaction(lineId: string, transactionId: string): Promise<LineRow> {
    return this.prisma.accountStatementLine.update({
      where: { id: lineId },
      data: { transactionId },
    });
  }

  private async loadLineById(lineId: string): Promise<LineRow> {
    const line = await this.prisma.accountStatementLine.findUnique({ where: { id: lineId } });
    if (!line) {
      throw new NotFoundException({
        message: 'Statement line not found',
        errorCode: ACCOUNT_ERRORS.STATEMENT_LINE_NOT_FOUND,
      });
    }
    return line;
  }

  /**
   * The response of a decision that wrote a transaction. The transaction is
   * re-read with the line, so the caller sees the FINAL state — including the
   * `statementLineId` back-link, which the transaction write itself could not
   * know yet.
   */
  private async decisionResponse(
    userId: string,
    line: LineRow,
    fallback: TransactionSummaryDto,
  ): Promise<StatementLineDecisionResponseDto> {
    const [mapped] = await this.mapLines(userId, [line]);
    return { line: mapped, transaction: mapped.transaction ?? fallback };
  }

  private async afterDecision(
    userId: string,
    account: AccountRow,
    line: LineRow,
    action: Parameters<typeof writeAccountAudit>[2]['action'],
    details: Record<string, unknown>,
  ): Promise<void> {
    await writeAccountAudit(this.prisma, this.logger, {
      userId,
      action,
      entityId: line.id,
      details: { accountId: account.id, ...details },
    });
    await publishAccountUpdated(this.prisma, this.eventBus, account, userId);
  }

  /** Categories among `ids` that the actor may actually file a row under. */
  private async loadUsableCategories(
    userId: string,
    ids: string[],
  ): Promise<TransactionCategorySummary[]> {
    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId },
      select: { groupId: true },
    });
    return this.prisma.category.findMany({
      where: {
        id: { in: ids },
        OR: categoryVisibilityClauses(
          userId,
          memberships.map((membership) => membership.groupId),
        ),
      },
      select: CATEGORY_SUMMARY_SELECT,
    });
  }

  /**
   * Serialize a page of lines, resolving every id a suggestion holds in ONE
   * batched query per kind (design §6.2 — never per line).
   */
  async mapLines(userId: string, rows: LineRow[]): Promise<StatementLineResponseDto[]> {
    if (rows.length === 0) return [];

    const snapshots = new Map<string, SuggestionSnapshot | null>(
      rows.map((row) => [row.id, readSuggestion(row.suggestion)]),
    );

    const transactionIds = new Set<string>();
    const categoryIds = new Set<string>();
    for (const row of rows) {
      if (row.transactionId) transactionIds.add(row.transactionId);
      const snapshot = snapshots.get(row.id);
      if (!snapshot) continue;
      if (snapshot.transactionId) transactionIds.add(snapshot.transactionId);
      if (snapshot.categoryId) categoryIds.add(snapshot.categoryId);
      for (const candidate of snapshot.candidates ?? []) {
        transactionIds.add(candidate.transactionId);
      }
    }

    const [transactions, categories] = await Promise.all([
      transactionIds.size
        ? this.prisma.transaction.findMany({
            where: {
              AND: [{ id: { in: [...transactionIds] } }, buildTransactionVisibilityWhere(userId)],
            },
            include: buildDetailInclude(userId),
          })
        : Promise.resolve([]),
      // A remembered category the reader cannot use is not surfaced at all
      // (security review L2) — the review UI would offer them a category they
      // could not have picked themselves.
      categoryIds.size ? this.loadUsableCategories(userId, [...categoryIds]) : Promise.resolve([]),
    ]);

    const summaries = new Map<string, TransactionSummaryDto>(
      transactions.map((row) => [
        row.id,
        mapTransactionToSummary(row as unknown as TransactionWithRelations, {
          starredByMe: row.stars.length > 0,
          commentCount: row._count.comments,
          hasDocuments: row._count.documents > 0,
        }),
      ]),
    );
    const categoryById = new Map<string, TransactionCategorySummary>(
      categories.map((category) => [category.id, category]),
    );

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      importId: row.importId,
      postedAt: row.postedAt.toISOString(),
      valueAt: row.valueAt ? row.valueAt.toISOString() : null,
      direction: row.direction as 'IN' | 'OUT',
      amountCents: row.amountCents,
      currency: row.currency,
      description: row.description,
      normalizedDescription: row.normalizedDescription,
      memo: row.memo,
      externalId: row.externalId,
      balanceAfterCents: row.balanceAfterCents,
      originalAmountCents: row.originalAmountCents,
      originalCurrency: row.originalCurrency,
      installmentNumber: row.installmentNumber,
      installmentTotal: row.installmentTotal,
      categoryHint: row.categoryHint,
      status: row.status as StatementLineStatus,
      // A line may be linked to a transaction this reader cannot see (a group
      // account matched to someone's personal row). Then neither the id nor
      // the summary is theirs to learn (security review L6).
      transactionId:
        row.transactionId && summaries.has(row.transactionId) ? row.transactionId : null,
      transaction: row.transactionId ? (summaries.get(row.transactionId) ?? null) : null,
      suggestion: resolveSuggestion(snapshots.get(row.id) ?? null, summaries, categoryById),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decidedById: row.decidedById,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

/** A group account's lines are attributed to the group, a personal one's to the actor. */
function defaultAttributions(account: AccountRow): AttributionDto[] {
  return account.scopeType === 'group' && account.groupId
    ? [{ scope: 'group', groupId: account.groupId }]
    : [{ scope: 'personal' }];
}

/** The stored snapshot, or null when the matcher never wrote one. */
function readSuggestion(value: Prisma.JsonValue | null): SuggestionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as SuggestionSnapshot;
}

/** Ids → embedded DTOs, from the page's batched lookups. */
function resolveSuggestion(
  snapshot: SuggestionSnapshot | null,
  transactions: Map<string, TransactionSummaryDto>,
  categories: Map<string, TransactionCategorySummary>,
): StatementSuggestionDto | null {
  if (!snapshot) return null;
  return {
    action: snapshot.action,
    score: snapshot.score,
    transaction: snapshot.transactionId ? (transactions.get(snapshot.transactionId) ?? null) : null,
    categoryId: snapshot.categoryId ?? null,
    category: snapshot.categoryId ? (categories.get(snapshot.categoryId) ?? null) : null,
    transferAccountId: snapshot.transferAccountId ?? null,
    candidates: (snapshot.candidates ?? []).flatMap((candidate) => {
      const transaction = transactions.get(candidate.transactionId);
      return transaction ? [{ transaction, score: candidate.score }] : [];
    }),
  };
}

/**
 * The `suggestion=` filter in SQL (design §6.2). `needs_input` reads the
 * snapshot's derived flag, which is exactly `none` ∪ `create` without a
 * remembered category — a predicate a JSON column cannot express directly.
 */
function suggestionFilter(
  filter: StatementSuggestionFilter,
): Prisma.AccountStatementLineWhereInput {
  if (filter === 'needs_input') {
    return { suggestion: { path: '$.needsInput', equals: true } };
  }
  if (filter === 'create') {
    return {
      AND: [
        { suggestion: { path: '$.action', equals: 'create' } },
        { suggestion: { path: '$.needsInput', equals: false } },
      ],
    };
  }
  return { suggestion: { path: '$.action', equals: filter } };
}
