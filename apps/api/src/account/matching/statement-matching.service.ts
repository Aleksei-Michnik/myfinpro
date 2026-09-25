// Phase 20 · Iteration 20.4 — the matcher's data access (design §5).
//
// Thin by construction: it builds the candidate pool, the transfer evidence
// and the category memory in a FIXED number of queries for a whole import
// (never one per line — an import is up to ACCOUNT_IMPORT_MAX_LINES rows and
// runs inline), hands them to the pure functions in `statement-matcher.ts`,
// and writes the resulting snapshots back.

import {
  STATEMENT_MATCH_DATE_WINDOW_DAYS,
  normalizeDescription,
  normalizeLookupName,
} from '@myfinpro/shared';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fuzzyLookupTokens, trigramSimilarity } from '../../product/utils/trigram.util';
import { categoryVisibilityClauses } from '../../category/utils/category-visibility';
import { buildTransactionVisibilityWhere } from '../../transaction/utils/transaction-visibility';
import { StatementLineService } from '../statement-line.service';
import { buildAccountVisibilityWhere } from '../utils/account-visibility';
import {
  buildCandidateIndex,
  buildSuggestion,
  detectCardBillTransfer,
  detectCounterpartTransfer,
  isConfidentMatch,
  MAX_SCORED_CANDIDATES_PER_LINE,
  rankCandidates,
  rankLinesForTransaction,
  type CounterLine,
  type MatchableCandidate,
  type MatchableLine,
  type SuggestionSnapshot,
  type VisibleCard,
} from './statement-matcher';

/** Statuses a bank line may settle: a plan occurrence posts when it clears. */
export const MATCHABLE_STATUSES = ['POSTED', 'PENDING', 'DUE'] as const;

/** Ceiling on the evidence rows one import may pull in (bounded memory). */
const EVIDENCE_TAKE = 500;

/** How similar a merchant name must be to stand in for a category memory. */
const MERCHANT_MEMORY_MIN_SIMILARITY = 0.6;

/** Suggestion writes per DB transaction when persisting an import's results. */
const SUGGESTION_WRITE_CHUNK = 100;

/**
 * How long a claimed-but-unattached line counts as "a decision in flight"
 * (see {@link StatementMatchingService.autoLink}). Long enough to cover any
 * request that is still writing its transaction, short enough that a crashed
 * one cannot disable auto-linking for an account for good.
 */
const DECISION_IN_FLIGHT_MS = 60_000;

const MS_PER_DAY = 86_400_000;

/** The statement-line columns the matcher needs. */
export interface MatchingLineRow {
  id: string;
  direction: string;
  amountCents: number;
  currency: string;
  normalizedDescription: string;
  postedAt: Date;
  valueAt: Date | null;
}

/** The account columns the matcher needs. */
export interface MatchingAccountRow {
  id: string;
  kind: string;
  currency: string;
  scopeType: string;
  ownerId: string | null;
  groupId: string | null;
}

@Injectable()
export class StatementMatchingService {
  private readonly logger = new Logger(StatementMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lines: StatementLineService,
  ) {}

  /**
   * Suggest an action for every given line, as the actor sees the world
   * (design §9: a group member can only be offered a match against a
   * transaction they may see).
   */
  async suggestForLines(
    userId: string,
    account: MatchingAccountRow,
    lines: MatchingLineRow[],
  ): Promise<Map<string, SuggestionSnapshot>> {
    const result = new Map<string, SuggestionSnapshot>();
    if (lines.length === 0) return result;

    const matchable: MatchableLine[] = lines.map((line) => ({
      id: line.id,
      direction: line.direction,
      amountCents: line.amountCents,
      currency: line.currency,
      normalizedDescription: line.normalizedDescription,
      at: line.valueAt ?? line.postedAt,
    }));

    const window = STATEMENT_MATCH_DATE_WINDOW_DAYS * MS_PER_DAY;
    const times = matchable.map((line) => line.at.getTime());
    const from = new Date(Math.min(...times) - window);
    const to = new Date(Math.max(...times) + window);

    const [candidates, cards, counterLines] = await Promise.all([
      this.loadCandidates(userId, account, matchable, from, to),
      this.loadVisibleCards(userId, account, matchable),
      this.loadCounterLines(userId, account, matchable, from, to),
    ]);

    // The pool is indexed ONCE — bucketed by direction, amount and currency,
    // with every candidate's trigram sets prebuilt — so matching a 2000-line
    // statement stays linear in the lines (security review H1).
    const index = buildCandidateIndex(candidates);

    // Rank and detect transfers first; only what is left over needs the
    // category memory, so its queries see the smallest possible input.
    const scored = matchable.map((line) => ({
      line,
      ranked: rankCandidates(line, index, account.id),
      transferAccountId:
        detectCardBillTransfer(line, account.kind, account.id, cards) ??
        detectCounterpartTransfer(line, counterLines, account.id),
    }));

    const memory = await this.loadCategoryMemory(
      userId,
      account,
      scored.filter((entry) => !entry.transferAccountId).map((entry) => entry.line),
    );

    for (const { line, ranked, transferAccountId } of scored) {
      result.set(
        line.id,
        buildSuggestion({
          ranked,
          transferAccountId,
          categoryId: memory.get(line.normalizedDescription) ?? null,
        }),
      );
    }
    return result;
  }

  /**
   * The other direction of design §5.5 — transaction → line: a transaction
   * that was just written onto an account takes the ONE pending bank line
   * that would score as a confident match for it, so a receipt photographed
   * on Tuesday and a statement imported on Friday meet without a click.
   * Ambiguity does nothing: the review queue asks.
   *
   * Best-effort by contract — it is called post-commit, fire-and-forget, and
   * NEVER throws to its caller. A concurrent manual decision always wins: the
   * link is taken through the same conditional claim the review queue uses,
   * so a lost race is just `null`.
   */
  async autoLink(actorId: string, transactionId: string): Promise<{ lineId: string } | null> {
    try {
      const transaction = await this.prisma.transaction.findFirst({
        where: { AND: [{ id: transactionId }, buildTransactionVisibilityWhere(actorId)] },
        select: {
          id: true,
          type: true,
          status: true,
          direction: true,
          amountCents: true,
          currency: true,
          occurredAt: true,
          accountId: true,
          transferAccountId: true,
          note: true,
          category: { select: { name: true } },
          receipt: { select: { merchant: { select: { normalizedName: true } } } },
          statementLine: { select: { id: true } },
        },
      });

      // Only a plain, unsettled one-off movement placed on an account can be
      // what a bank line records (design §5.1). A transfer is recorded by the
      // review queue's transfer decision, never here.
      if (!transaction?.accountId) return null;
      if (transaction.transferAccountId !== null) return null;
      if (transaction.type !== 'ONE_TIME') return null;
      if (!(MATCHABLE_STATUSES as readonly string[]).includes(transaction.status)) return null;
      if (transaction.statementLine) return null;

      const account = await this.prisma.account.findFirst({
        where: {
          AND: [
            { id: transaction.accountId, archivedAt: null },
            buildAccountVisibilityWhere(actorId),
          ],
        },
      });
      if (!account) return null;
      if (await this.decisionInFlight(account.id)) return null;

      const window = STATEMENT_MATCH_DATE_WINDOW_DAYS * MS_PER_DAY;
      const from = new Date(transaction.occurredAt.getTime() - window);
      const to = new Date(transaction.occurredAt.getTime() + window);
      const rows = await this.prisma.accountStatementLine.findMany({
        where: {
          accountId: account.id,
          status: 'PENDING',
          direction: transaction.direction,
          amountCents: transaction.amountCents,
          currency: transaction.currency,
          OR: [{ postedAt: { gte: from, lte: to } }, { valueAt: { gte: from, lte: to } }],
        },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
        take: MAX_SCORED_CANDIDATES_PER_LINE,
      });
      if (rows.length === 0) return null;

      const candidate: MatchableCandidate = {
        id: transaction.id,
        direction: transaction.direction,
        amountCents: transaction.amountCents,
        currency: transaction.currency,
        occurredAt: transaction.occurredAt,
        accountId: transaction.accountId,
        transferAccountId: transaction.transferAccountId,
        texts: [
          transaction.note ? normalizeDescription(transaction.note) : '',
          transaction.receipt?.merchant?.normalizedName ?? '',
          normalizeLookupName(transaction.category.name),
        ],
      };
      const ranked = rankLinesForTransaction(
        candidate,
        rows.map((row) => ({
          id: row.id,
          direction: row.direction,
          amountCents: row.amountCents,
          currency: row.currency,
          normalizedDescription: row.normalizedDescription,
          at: row.valueAt ?? row.postedAt,
        })),
        account.id,
      );
      if (!isConfidentMatch(ranked)) return null;

      const line = rows.find((row) => row.id === ranked[0].lineId);
      if (!line) return null;

      // The same claim → confirm → audit → fan-out path a person's `match`
      // decision takes; a conflict means someone decided this line (or this
      // transaction) first, and the auto-linker simply steps aside.
      await this.lines.linkLineToTransaction(actorId, account, line, transaction.id);
      this.logger.log(
        `Auto-linked transaction ${transaction.id} to statement line ${line.id} on account ${account.id}`,
      );
      return { lineId: line.id };
    } catch (err) {
      // Ids only — a statement description never reaches a log (design §9).
      this.logger.warn(
        `Auto-link skipped for transaction ${transactionId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Is a review-queue decision mid-flight on this account? `create` and
   * `transfer` claim their line BEFORE they write the transaction, so a
   * recently claimed line with no transaction yet means the row that just
   * triggered this call is that decision's own. Linking it to a look-alike
   * line would steal the transaction the decision is about to attach, so the
   * auto-linker stands down and leaves the queue to finish.
   */
  private async decisionInFlight(accountId: string): Promise<boolean> {
    const claimed = await this.prisma.accountStatementLine.count({
      where: {
        accountId,
        status: { in: ['CREATED', 'MATCHED'] },
        transactionId: null,
        decidedAt: { gte: new Date(Date.now() - DECISION_IN_FLIGHT_MS) },
      },
    });
    return claimed > 0;
  }

  /** Store the snapshots on their lines, in bounded chunks. */
  async persistSuggestions(suggestions: Map<string, SuggestionSnapshot>): Promise<void> {
    const entries = [...suggestions.entries()];
    for (let i = 0; i < entries.length; i += SUGGESTION_WRITE_CHUNK) {
      const chunk = entries.slice(i, i + SUGGESTION_WRITE_CHUNK);
      await this.prisma.$transaction(
        chunk.map(([lineId, suggestion]) =>
          this.prisma.accountStatementLine.update({
            where: { id: lineId },
            data: { suggestion: suggestion as unknown as Prisma.InputJsonValue },
          }),
        ),
      );
    }
    this.logger.log(`Stored ${entries.length} statement-line suggestions`);
  }

  // ── evidence ──

  /**
   * The candidate pool (design §5.1) in ONE query: visible, `ONE_TIME`,
   * settle-able, same currency, not already confirmed by a line, on no
   * account or on this one, with an amount and direction some line asks for
   * and a date inside the union of the windows. The in-memory admissibility
   * check (`isAdmissible`) narrows it per line.
   */
  private async loadCandidates(
    userId: string,
    account: MatchingAccountRow,
    lines: MatchableLine[],
    from: Date,
    to: Date,
  ): Promise<MatchableCandidate[]> {
    const amountsByDirection = new Map<string, Set<number>>();
    for (const line of lines) {
      const set = amountsByDirection.get(line.direction) ?? new Set<number>();
      set.add(line.amountCents);
      amountsByDirection.set(line.direction, set);
    }

    const shapes: Prisma.TransactionWhereInput[] = [];
    for (const [direction, amounts] of amountsByDirection) {
      shapes.push({
        direction,
        amountCents: { in: [...amounts] },
        transferAccountId: null,
        OR: [{ accountId: null }, { accountId: account.id }],
      });
    }
    // The one place a transfer row is a candidate (design §5.3): the bank
    // side created the card bill first and the card's IN line matches it.
    const inAmounts = amountsByDirection.get('IN');
    if (account.kind === 'CARD' && inAmounts?.size) {
      shapes.push({ transferAccountId: account.id, amountCents: { in: [...inAmounts] } });
    }

    const rows = await this.prisma.transaction.findMany({
      where: {
        AND: [
          buildTransactionVisibilityWhere(userId),
          {
            type: 'ONE_TIME',
            status: { in: [...MATCHABLE_STATUSES] },
            currency: account.currency,
            statementLine: { is: null },
            occurredAt: { gte: from, lte: to },
          },
          { OR: shapes },
        ],
      },
      select: {
        id: true,
        direction: true,
        amountCents: true,
        currency: true,
        occurredAt: true,
        accountId: true,
        transferAccountId: true,
        note: true,
        category: { select: { name: true } },
        receipt: { select: { merchant: { select: { normalizedName: true } } } },
      },
      take: EVIDENCE_TAKE,
    });

    return rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      amountCents: row.amountCents,
      currency: row.currency,
      occurredAt: row.occurredAt,
      accountId: row.accountId,
      transferAccountId: row.transferAccountId,
      texts: [
        row.note ? normalizeDescription(row.note) : '',
        row.receipt?.merchant?.normalizedName ?? '',
        normalizeLookupName(row.category.name),
      ],
    }));
  }

  /** Visible, active CARD accounts — the transfer proposal's targets (§5.3). */
  private async loadVisibleCards(
    userId: string,
    account: MatchingAccountRow,
    lines: MatchableLine[],
  ): Promise<VisibleCard[]> {
    if (account.kind !== 'BANK' || !lines.some((line) => line.direction === 'OUT')) return [];
    const rows = await this.prisma.account.findMany({
      where: {
        AND: [
          { kind: 'CARD', archivedAt: null, currency: account.currency },
          buildAccountVisibilityWhere(userId),
        ],
      },
      select: { id: true, institution: true, billingAccountId: true },
    });
    return rows;
  }

  /** Equal-and-opposite lines on other visible accounts (§5.3). */
  private async loadCounterLines(
    userId: string,
    account: MatchingAccountRow,
    lines: MatchableLine[],
    from: Date,
    to: Date,
  ): Promise<CounterLine[]> {
    const amounts = [...new Set(lines.map((line) => line.amountCents))];
    const rows = await this.prisma.accountStatementLine.findMany({
      where: {
        AND: [
          { accountId: { not: account.id } },
          { account: { is: buildAccountVisibilityWhere(userId) } },
          {
            currency: account.currency,
            amountCents: { in: amounts },
            postedAt: { gte: from, lte: to },
          },
        ],
      },
      select: {
        accountId: true,
        direction: true,
        amountCents: true,
        currency: true,
        postedAt: true,
        valueAt: true,
      },
      take: EVIDENCE_TAKE,
    });

    return rows.map((row) => ({
      accountId: row.accountId,
      direction: row.direction,
      amountCents: row.amountCents,
      currency: row.currency,
      at: row.valueAt ?? row.postedAt,
    }));
  }

  /**
   * Category memory (design §5.4): the primary category of the most recent
   * decided line with the same `normalizedDescription` in the same scope —
   * the lines table IS the memory, no extra table. Failing that, the category
   * of the actor's most recent confirmed receipt whose merchant name is a
   * token/trigram match for the description.
   */
  private async loadCategoryMemory(
    userId: string,
    account: MatchingAccountRow,
    lines: MatchableLine[],
  ): Promise<Map<string, string>> {
    const memory = new Map<string, string>();
    const descriptions = [...new Set(lines.map((line) => line.normalizedDescription))].filter(
      (value) => value !== '',
    );
    if (descriptions.length === 0) return memory;

    const scopeSiblings =
      account.scopeType === 'personal'
        ? { scopeType: 'personal', ownerId: account.ownerId }
        : { scopeType: 'group', groupId: account.groupId };

    const decided = await this.prisma.accountStatementLine.findMany({
      where: {
        account: { is: scopeSiblings },
        normalizedDescription: { in: descriptions.slice(0, EVIDENCE_TAKE) },
        status: { in: ['MATCHED', 'CREATED'] },
        transactionId: { not: null },
      },
      orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        normalizedDescription: true,
        transaction: { select: { categoryId: true } },
      },
      take: EVIDENCE_TAKE,
    });

    for (const row of decided) {
      if (!row.transaction) continue;
      if (!memory.has(row.normalizedDescription)) {
        memory.set(row.normalizedDescription, row.transaction.categoryId);
      }
    }

    const unresolved = descriptions.filter((value) => !memory.has(value));
    if (unresolved.length === 0) return memory;

    const receipts = await this.prisma.receipt.findMany({
      where: {
        uploadedById: userId,
        status: 'CONFIRMED',
        merchantId: { not: null },
        transactionId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        merchant: { select: { normalizedName: true } },
        transaction: { select: { categoryId: true } },
      },
      take: EVIDENCE_TAKE,
    });
    if (receipts.length === 0) return memory;

    for (const description of unresolved) {
      const tokens = fuzzyLookupTokens(description);
      let best: { score: number; categoryId: string } | null = null;
      for (const receipt of receipts) {
        const name = receipt.merchant?.normalizedName;
        const categoryId = receipt.transaction?.categoryId;
        if (!name || !categoryId) continue;
        const score = tokens.some((token) => name.includes(token))
          ? 1
          : trigramSimilarity(description, name);
        if (score >= MERCHANT_MEMORY_MIN_SIMILARITY && (!best || score > best.score)) {
          best = { score, categoryId };
        }
      }
      if (best) memory.set(description, best.categoryId);
    }

    return this.dropUnusableCategories(userId, memory);
  }

  /**
   * A memory is only worth proposing if the reviewer could have picked the
   * category themselves: a line decided by another member may remember a
   * category personal to them, and "apply all" would then file money under a
   * category this actor cannot even see (security review L2).
   */
  private async dropUnusableCategories(
    userId: string,
    memory: Map<string, string>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(memory.values())];
    if (ids.length === 0) return memory;

    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const usable = await this.prisma.category.findMany({
      where: {
        id: { in: ids },
        OR: categoryVisibilityClauses(
          userId,
          memberships.map((membership) => membership.groupId),
        ),
      },
      select: { id: true },
    });
    const allowed = new Set(usable.map((category) => category.id));

    for (const [description, categoryId] of memory) {
      if (!allowed.has(categoryId)) memory.delete(description);
    }
    return memory;
  }
}
