import {
  ACCOUNT_IMPORT_MAX_LINES,
  decodeCursor,
  encodeCursor,
  IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH,
  IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH,
  normalizeDescription,
  sanitizeStatementText,
  STATEMENT_DESCRIPTION_MAX_LENGTH,
} from '@myfinpro/shared';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../realtime/event-bus.service';
import { AccountService } from './account.service';
import { ACCOUNT_ERRORS } from './constants/account-errors';
import {
  AccountImportListResponseDto,
  AccountImportResponseDto,
} from './dto/account-import-response.dto';
import { CreateImportDto } from './dto/create-import.dto';
import { ImportLineDto } from './dto/import-line.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';
import type { SuggestionSnapshot } from './matching/statement-matcher';
import { StatementMatchingService } from './matching/statement-matching.service';
import { publishAccountUpdated, writeAccountAudit } from './utils/account-side-effects';
import { fingerprintImportLines } from './utils/statement-fingerprint';

/** No statement predates online banking; the future needs only timezone grace. */
const EARLIEST_PLAUSIBLE_LINE_DATE = Date.UTC(2000, 0, 1);
const FUTURE_GRACE_MS = 2 * 86_400_000;

type AccountRow = Prisma.AccountGetPayload<Record<string, never>>;

/** A validated line, ready to be fingerprinted and stored. */
interface PreparedLine {
  postedAt: Date;
  valueAt: Date | null;
  direction: string;
  amountCents: number;
  currency: string;
  description: string;
  normalizedDescription: string;
  memo: string | null;
  externalId: string | null;
  balanceAfterCents: number | null;
  originalAmountCents: number | null;
  originalCurrency: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  categoryHint: string | null;
}

/**
 * Phase 20 · Iteration 20.4 — statement imports (design §6.2).
 *
 * The server never sees the statement FILE: the browser decodes and parses
 * it with the shared parser and posts normalised lines. Here they are
 * validated, fingerprinted, inserted past the `(accountId, fingerprint)`
 * dedup fence — duplicates are counted, never an error — and handed to the
 * matcher, whose proposals are stored on the lines for the review queue.
 *
 * Any owner or group member may import: it is data entry, like adding a
 * group transaction (design §2.1).
 */
@Injectable()
export class AccountImportService {
  private readonly logger = new Logger(AccountImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly matching: StatementMatchingService,
    private readonly eventBus: EventBus,
  ) {}

  async create(
    userId: string,
    accountId: string,
    dto: CreateImportDto,
  ): Promise<AccountImportResponseDto> {
    const account = await this.accounts.loadForRead(userId, accountId);
    if (account.archivedAt) {
      throw new ConflictException({
        message: 'Cannot import into an archived account — unarchive it first',
        errorCode: ACCOUNT_ERRORS.ACCOUNT_ARCHIVED,
      });
    }
    if (dto.lines.length > ACCOUNT_IMPORT_MAX_LINES) {
      throw new BadRequestException({
        message: `An import carries at most ${ACCOUNT_IMPORT_MAX_LINES} lines — send the statement in consecutive chunks`,
        errorCode: ACCOUNT_ERRORS.ACCOUNT_IMPORT_TOO_LARGE,
      });
    }

    const prepared = dto.lines.map((line, index) => this.prepareLine(line, index, account));
    const fingerprints = fingerprintImportLines(
      accountId,
      prepared.map((line) => ({
        postedAt: line.postedAt.toISOString().slice(0, 10),
        direction: line.direction,
        amountCents: line.amountCents,
        normalizedDescription: line.normalizedDescription,
      })),
    );

    // The statement balance is the bank's own figure and stays member-level
    // data entry — but it becomes the account's reported balance, which the
    // reconciliation gap is measured against, so its date is bounded exactly
    // like a line's (security review M1).
    const statementBalanceAt = dto.statementBalanceAt
      ? this.parsePlausibleDate(dto.statementBalanceAt, {
          message: 'statementBalanceAt is outside the plausible range',
          errorCode: ACCOUNT_ERRORS.ACCOUNT_IMPORT_INVALID_BALANCE,
        })
      : null;
    const updatesReportedBalance =
      dto.statementBalanceCents !== undefined &&
      statementBalanceAt !== null &&
      // `>=`: re-importing a corrected statement of the SAME day must be able
      // to fix the figure.
      (account.reportedBalanceAt === null || statementBalanceAt >= account.reportedBalanceAt);

    // One DB transaction: the import row, its lines (duplicates skipped by
    // the unique fence) and the reported balance move together or not at all.
    const importRow = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.accountImport.create({
          data: {
            accountId,
            importedById: userId,
            source: dto.source,
            originalName: dto.originalName ?? null,
            periodFrom: dto.periodFrom ? new Date(dto.periodFrom) : null,
            periodTo: dto.periodTo ? new Date(dto.periodTo) : null,
            statementBalanceCents: dto.statementBalanceCents ?? null,
            statementBalanceAt,
            totalCount: prepared.length,
          },
        });

        const inserted = await tx.accountStatementLine.createMany({
          data: prepared.map((line, index) => ({
            accountId,
            importId: created.id,
            fingerprint: fingerprints[index].fingerprint,
            ...line,
          })),
          skipDuplicates: true,
        });

        if (updatesReportedBalance) {
          await tx.account.update({
            where: { id: accountId },
            data: {
              reportedBalanceCents: dto.statementBalanceCents,
              reportedBalanceAt: statementBalanceAt,
            },
          });
        }

        return tx.accountImport.update({
          where: { id: created.id },
          data: {
            insertedCount: inserted.count,
            duplicateCount: prepared.length - inserted.count,
          },
        });
      },
      { timeout: 30_000 },
    );

    // The matcher runs inline (an import is at most ACCOUNT_IMPORT_MAX_LINES
    // rows) but outside the write transaction: its proposals are an advisory
    // snapshot, and holding row locks across the candidate queries would
    // serialise every import on the account.
    const storedLines = await this.prisma.accountStatementLine.findMany({
      where: { importId: importRow.id },
      select: {
        id: true,
        direction: true,
        amountCents: true,
        currency: true,
        normalizedDescription: true,
        postedAt: true,
        valueAt: true,
      },
    });
    const suggestions = await this.matching.suggestForLines(userId, account, storedLines);
    await this.matching.persistSuggestions(suggestions);

    await writeAccountAudit(this.prisma, this.logger, {
      userId,
      action: 'ACCOUNT_IMPORT_CREATED',
      entityId: importRow.id,
      details: {
        accountId,
        source: dto.source,
        totalCount: importRow.totalCount,
        insertedCount: importRow.insertedCount,
        duplicateCount: importRow.duplicateCount,
        reportedBalanceUpdated: updatesReportedBalance,
      },
    });
    this.logger.log(
      `Import ${importRow.id} on account ${accountId} by user ${userId}: ${importRow.insertedCount} inserted, ${importRow.duplicateCount} duplicates`,
    );

    await publishAccountUpdated(this.prisma, this.eventBus, account, userId);

    return this.mapImport(importRow, countSuggestions([...suggestions.values()]));
  }

  /** Cursor list of an account's imports, newest first (design §6.2). */
  async list(
    userId: string,
    accountId: string,
    query: ListImportsQueryDto,
  ): Promise<AccountImportListResponseDto> {
    await this.accounts.loadForRead(userId, accountId);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

    const where: Prisma.AccountImportWhereInput = { accountId };
    if (query.cursor) {
      let createdAt: Date;
      let id: string;
      try {
        const decoded = decodeCursor(query.cursor);
        createdAt = new Date(decoded.createdAt as string);
        id = decoded.id as string;
        if (Number.isNaN(createdAt.getTime()) || typeof id !== 'string') {
          throw new Error('bad cursor');
        }
      } catch {
        throw new BadRequestException({ message: 'Invalid cursor' });
      }
      where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }];
    }

    const rows = await this.prisma.accountImport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const counters = await this.countPendingSuggestions(page.map((row) => row.id));
    const last = page[page.length - 1];

    return {
      data: page.map((row) =>
        this.mapImport(row, counters.get(row.id) ?? emptySuggestionCounters()),
      ),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
      hasMore,
    };
  }

  // ── helpers ──

  /**
   * Validate and sanitize one line. Every rejection names the line's INDEX
   * and nothing else — statement content never rides in an error (design §9).
   */
  private prepareLine(line: ImportLineDto, index: number, account: AccountRow): PreparedLine {
    const invalid = (reason: string): never => {
      throw new BadRequestException({
        message: `Line ${index} is invalid: ${reason}`,
        errorCode: ACCOUNT_ERRORS.ACCOUNT_IMPORT_INVALID_LINE,
      });
    };

    const currency = line.currency ?? account.currency;
    if (currency !== account.currency) {
      throw new BadRequestException({
        message: `Line ${index} is denominated in ${currency}, but the account holds ${account.currency}`,
        errorCode: ACCOUNT_ERRORS.ACCOUNT_CURRENCY_MISMATCH,
      });
    }

    const postedAt = this.parseLineDate(line.postedAt, index, 'postedAt');
    const valueAt = line.valueAt ? this.parseLineDate(line.valueAt, index, 'valueAt') : null;

    if (
      (line.installmentNumber === undefined) !== (line.installmentTotal === undefined) ||
      (line.installmentNumber !== undefined &&
        line.installmentTotal !== undefined &&
        line.installmentNumber > line.installmentTotal)
    ) {
      invalid('the installment marker is not an "n of N" pair');
    }

    const description = sanitizeStatementText(line.description, STATEMENT_DESCRIPTION_MAX_LENGTH);
    if (!description) invalid('the description is empty after sanitisation');

    return {
      postedAt,
      valueAt,
      direction: line.direction,
      amountCents: line.amountCents,
      currency,
      description,
      normalizedDescription: normalizeDescription(line.description),
      memo: line.memo ? sanitizeStatementText(line.memo, STATEMENT_DESCRIPTION_MAX_LENGTH) : null,
      externalId: line.externalId
        ? sanitizeStatementText(line.externalId, IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH)
        : null,
      balanceAfterCents: line.balanceAfterCents ?? null,
      originalAmountCents: line.originalAmountCents ?? null,
      originalCurrency: line.originalCurrency ?? null,
      installmentNumber: line.installmentNumber ?? null,
      installmentTotal: line.installmentTotal ?? null,
      categoryHint: line.categoryHint
        ? sanitizeStatementText(line.categoryHint, IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH)
        : null,
    };
  }

  private parseLineDate(value: string, index: number, field: string): Date {
    return this.parsePlausibleDate(value, {
      message: `Line ${index} is invalid: ${field} is outside the plausible range`,
      errorCode: ACCOUNT_ERRORS.ACCOUNT_IMPORT_INVALID_LINE,
    });
  }

  /**
   * One range for every date an import carries: no statement predates online
   * banking, and the future needs only a little timezone grace.
   */
  private parsePlausibleDate(value: string, error: { message: string; errorCode: string }): Date {
    const date = new Date(value);
    const time = date.getTime();
    if (
      Number.isNaN(time) ||
      time < EARLIEST_PLAUSIBLE_LINE_DATE ||
      time > Date.now() + FUTURE_GRACE_MS
    ) {
      throw new BadRequestException(error);
    }
    return date;
  }

  private mapImport(
    row: Prisma.AccountImportGetPayload<Record<string, never>>,
    counters: SuggestionCounters,
  ): AccountImportResponseDto {
    return {
      id: row.id,
      accountId: row.accountId,
      importedById: row.importedById,
      source: row.source,
      originalName: row.originalName,
      periodFrom: row.periodFrom ? row.periodFrom.toISOString() : null,
      periodTo: row.periodTo ? row.periodTo.toISOString() : null,
      statementBalanceCents: row.statementBalanceCents,
      statementBalanceAt: row.statementBalanceAt ? row.statementBalanceAt.toISOString() : null,
      totalCount: row.totalCount,
      insertedCount: row.insertedCount,
      duplicateCount: row.duplicateCount,
      ...counters,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Suggestion counters for a page of imports: four grouped counts over the
   * still-pending lines, never one query per import. A decided line no longer
   * counts anywhere — the counters answer "what is left to review".
   */
  private async countPendingSuggestions(
    importIds: string[],
  ): Promise<Map<string, SuggestionCounters>> {
    const counters = new Map<string, SuggestionCounters>();
    if (importIds.length === 0) return counters;

    const base: Prisma.AccountStatementLineWhereInput = {
      importId: { in: importIds },
      status: 'PENDING',
    };
    const countBy = async (
      filter: Prisma.AccountStatementLineWhereInput,
    ): Promise<Map<string, number>> => {
      const rows = await this.prisma.accountStatementLine.groupBy({
        by: ['importId'],
        where: { ...base, ...filter },
        _count: { _all: true },
      });
      return new Map(rows.map((row) => [row.importId, row._count._all]));
    };

    const [match, transfer, create, needsInput] = await Promise.all([
      countBy({ suggestion: { path: '$.action', equals: 'match' } }),
      countBy({ suggestion: { path: '$.action', equals: 'transfer' } }),
      countBy({
        suggestion: { path: '$.action', equals: 'create' },
        AND: [{ suggestion: { path: '$.needsInput', equals: false } }],
      }),
      countBy({ suggestion: { path: '$.needsInput', equals: true } }),
    ]);

    for (const importId of importIds) {
      counters.set(importId, {
        suggestedMatchCount: match.get(importId) ?? 0,
        suggestedTransferCount: transfer.get(importId) ?? 0,
        suggestedCreateCount: create.get(importId) ?? 0,
        needsInputCount: needsInput.get(importId) ?? 0,
      });
    }
    return counters;
  }
}

interface SuggestionCounters {
  suggestedMatchCount: number;
  suggestedTransferCount: number;
  suggestedCreateCount: number;
  needsInputCount: number;
}

function emptySuggestionCounters(): SuggestionCounters {
  return {
    suggestedMatchCount: 0,
    suggestedTransferCount: 0,
    suggestedCreateCount: 0,
    needsInputCount: 0,
  };
}

/** Counters straight from a fresh import's snapshots — no second query. */
function countSuggestions(snapshots: SuggestionSnapshot[]): SuggestionCounters {
  const counters = emptySuggestionCounters();
  for (const snapshot of snapshots) {
    if (snapshot.needsInput) counters.needsInputCount++;
    else if (snapshot.action === 'match') counters.suggestedMatchCount++;
    else if (snapshot.action === 'transfer') counters.suggestedTransferCount++;
    else if (snapshot.action === 'create') counters.suggestedCreateCount++;
  }
  return counters;
}
