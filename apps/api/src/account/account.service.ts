import {
  decodeCursor,
  encodeCursor,
  INSTITUTION_META,
  type AccountInstitution,
  type AccountKind,
} from '@myfinpro/shared';
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
import { COUNTABLE_TRANSACTION_WHERE } from '../transaction/utils/countable';
import { ACCOUNT_ERRORS } from './constants/account-errors';
import { AccountListResponseDto } from './dto/account-list-response.dto';
import { AccountResponseDto } from './dto/account-response.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import {
  publishAccountUpdated,
  writeAccountAudit,
  type AccountAuditAction,
} from './utils/account-side-effects';
import { buildAccountVisibilityWhere } from './utils/account-visibility';

type AccountRow = Prisma.AccountGetPayload<Record<string, never>>;

/** The four figures the API derives per account (design §2.2 / §2.3). */
export interface DerivedAccountFigures {
  ledgerBalanceCents: number;
  ledgerBalanceAt: string;
  pendingLinesCount: number;
  reconciliationGapCents: number | null;
}

/**
 * Half-open `occurredAt` window a ledger sum is taken over:
 * `[from, to)` — design §2.2 sums transactions with
 * `occurredAt ∈ [openingBalanceAt, at)`, so a row dated in the future (the
 * create endpoint allows up to a day of timezone grace) is not money yet.
 */
interface LedgerWindow {
  accountId: string;
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

/** Serialize an Account row + its derived figures into the API response. */
export function mapAccountToResponse(
  row: AccountRow,
  derived: DerivedAccountFigures,
): AccountResponseDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as AccountKind,
    institution: row.institution,
    currency: row.currency,
    last4: row.last4,
    color: row.color,
    scopeType: row.scopeType as 'personal' | 'group',
    ownerId: row.ownerId,
    groupId: row.groupId,
    openingBalanceCents: row.openingBalanceCents,
    openingBalanceAt: row.openingBalanceAt.toISOString(),
    reportedBalanceCents: row.reportedBalanceCents,
    reportedBalanceAt: row.reportedBalanceAt ? row.reportedBalanceAt.toISOString() : null,
    billingAccountId: row.billingAccountId,
    billingDay: row.billingDay,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...derived,
  };
}

/**
 * Phase 20 · Iteration 20.2 — Account CRUD/archive service with derived
 * ledger balances.
 *
 * Access matrix (design §2.1, mirroring budgets): personal accounts are
 * managed and read by their owner; group accounts are mutated by group
 * ADMINs and read by any member. Non-accessors always get 404
 * (`ACCOUNT_NOT_FOUND`) — existence is never leaked. The single deliberate
 * 403 (`ACCOUNT_FORBIDDEN`) is a group member attempting a mutation, because
 * the account IS visible to them.
 *
 * Balances are never stored (design §2.2): every read recomputes them with a
 * fixed number of aggregate queries over the listed ids — never one query per
 * account. Statement imports, line decisions and the matcher land in 20.4.
 */
/** The anchor of an account created without an opening balance date: the beginning of time. */
const ANCHOR_EPOCH = 0;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async create(userId: string, dto: CreateAccountDto): Promise<AccountResponseDto> {
    // 1. Scope — exactly one of ownerId/groupId, mirroring budgets.
    let ownerId: string | null = null;
    let groupId: string | null = null;
    let groupCurrency: string | null = null;

    if (dto.scopeType === 'personal') {
      if (dto.groupId !== undefined && dto.groupId !== null) {
        throw new BadRequestException({
          message: 'personal accounts must not carry a groupId',
          errorCode: ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
        });
      }
      ownerId = userId;
    } else {
      if (!dto.groupId) {
        throw new BadRequestException({
          message: 'groupId is required when scopeType=group',
          errorCode: ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
        });
      }
      groupCurrency = await this.requireGroupAdminForCreate(userId, dto.groupId);
      groupId = dto.groupId;
    }

    // 2. Institution — the DTO checked membership in the closed list; the
    //    institution must also issue accounts of this kind.
    this.validateInstitutionForKind(dto.institution ?? null, dto.kind);

    // 3. Currency — default to the owner's / group's defaultCurrency, like budgets.
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

    // 4. Billing (CARD only) — a visible, active BANK account in the same
    //    scope and currency; billingDay needs one.
    await this.validateBilling({
      userId,
      kind: dto.kind,
      currency,
      scopeType: dto.scopeType,
      ownerId,
      groupId,
      billingAccountId: dto.billingAccountId ?? null,
      billingDay: dto.billingDay ?? null,
      explicitBillingDay: dto.billingDay !== undefined && dto.billingDay !== null,
    });

    const created = await this.prisma.account.create({
      data: {
        name: dto.name,
        kind: dto.kind,
        institution: dto.institution ?? null,
        currency,
        last4: dto.last4 ?? null,
        color: dto.color ?? null,
        scopeType: dto.scopeType,
        ownerId,
        groupId,
        openingBalanceCents: dto.openingBalanceCents ?? 0,
        // No anchor given ⇒ count everything: an account created today with
        // yesterday's expenses must show them, and a "now" anchor would even
        // exclude a same-minute entry (the form's datetime has no seconds).
        // An explicit opening balance carries its own date (validated by the
        // web form; the DTO allows either alone).
        openingBalanceAt: dto.openingBalanceAt
          ? new Date(dto.openingBalanceAt)
          : new Date(ANCHOR_EPOCH),
        reportedBalanceCents: dto.reportedBalanceCents ?? null,
        reportedBalanceAt: dto.reportedBalanceAt ? new Date(dto.reportedBalanceAt) : null,
        billingAccountId: dto.billingAccountId ?? null,
        billingDay: dto.billingDay ?? null,
        createdById: userId,
      },
    });

    await this.writeAudit(userId, created.id, 'ACCOUNT_CREATED', {
      name: created.name,
      kind: created.kind,
      institution: created.institution,
      currency: created.currency,
      scopeType: created.scopeType,
      groupId: created.groupId,
      openingBalanceCents: created.openingBalanceCents,
    });

    this.logger.log(
      `Account ${created.id} (${created.kind}, ${created.scopeType}) created by user ${userId}`,
    );

    await this.publishAccountUpdated(created, userId);
    return this.toResponse(created);
  }

  /**
   * List accounts visible to `userId` — personal own + all member groups,
   * narrowed by `scope`, excluding archived unless `includeArchived=true`.
   * Cursor pagination over (createdAt DESC, id DESC), same as budgets.
   */
  async list(userId: string, q: ListAccountsQueryDto): Promise<AccountListResponseDto> {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const scopeRaw = q.scope ?? 'all';

    let visibility: Prisma.AccountWhereInput;
    if (scopeRaw === 'personal') {
      visibility = { scopeType: 'personal', ownerId: userId };
    } else if (scopeRaw.startsWith('group:')) {
      const groupId = scopeRaw.slice('group:'.length);
      const membership = await this.prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { id: true },
      });
      if (!membership) {
        // Same contract as GET /budgets?scope=group:<id> for a non-member.
        throw new ForbiddenException({
          message: 'Requested group scope is not accessible',
          errorCode: ACCOUNT_ERRORS.ACCOUNT_FORBIDDEN,
        });
      }
      visibility = { scopeType: 'group', groupId };
    } else {
      visibility = buildAccountVisibilityWhere(userId);
    }

    const where: Prisma.AccountWhereInput = { AND: [visibility] };
    if (q.includeArchived !== 'true') {
      (where.AND as Prisma.AccountWhereInput[]).push({ archivedAt: null });
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
      (where.AND as Prisma.AccountWhereInput[]).push({
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
      });
    }

    const rows = await this.prisma.account.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const derived = await this.deriveFigures(page);
    const last = page[page.length - 1];

    return {
      data: page.map((row) => mapAccountToResponse(row, derived.get(row.id)!)),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
      hasMore,
    };
  }

  async findById(userId: string, id: string): Promise<AccountResponseDto> {
    return this.toResponse(await this.loadForRead(userId, id));
  }

  async update(userId: string, id: string, dto: UpdateAccountDto): Promise<AccountResponseDto> {
    const existing = await this.loadForManage(userId, id);
    this.rejectArchived(existing, 'edit');
    this.rejectScopeChange(existing, dto);

    const data: Prisma.AccountUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.last4 !== undefined) data.last4 = dto.last4;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.openingBalanceCents !== undefined) data.openingBalanceCents = dto.openingBalanceCents;
    if (dto.openingBalanceAt !== undefined) data.openingBalanceAt = new Date(dto.openingBalanceAt);
    if (dto.reportedBalanceCents !== undefined) {
      data.reportedBalanceCents = dto.reportedBalanceCents;
    }
    if (dto.reportedBalanceAt !== undefined) {
      data.reportedBalanceAt = dto.reportedBalanceAt ? new Date(dto.reportedBalanceAt) : null;
    }

    if (dto.institution !== undefined) {
      this.validateInstitutionForKind(dto.institution, existing.kind as AccountKind);
      data.institution = dto.institution;
    }

    // Billing — validate against the merged (effective) state so a partial
    // patch cannot leave a billingDay without its account. Clearing the
    // account clears an inherited day silently; asking for both at once is
    // rejected.
    if (dto.billingAccountId !== undefined || dto.billingDay !== undefined) {
      const billingAccountId =
        dto.billingAccountId !== undefined ? dto.billingAccountId : existing.billingAccountId;
      const explicitBillingDay = dto.billingDay !== undefined && dto.billingDay !== null;
      let billingDay = dto.billingDay !== undefined ? dto.billingDay : existing.billingDay;
      if (billingAccountId === null && !explicitBillingDay) billingDay = null;

      await this.validateBilling({
        userId,
        kind: existing.kind as AccountKind,
        currency: existing.currency,
        scopeType: existing.scopeType as 'personal' | 'group',
        ownerId: existing.ownerId,
        groupId: existing.groupId,
        billingAccountId,
        billingDay,
        explicitBillingDay,
        selfId: existing.id,
      });
      data.billingAccountId = billingAccountId;
      data.billingDay = billingDay;
    }

    if (Object.keys(data).length === 0) {
      return this.toResponse(existing);
    }

    const updated = await this.prisma.account.update({ where: { id }, data });

    await this.writeAudit(userId, id, 'ACCOUNT_UPDATED', {
      changes: data as Record<string, unknown>,
    });
    this.logger.log(`Account ${id} updated by user ${userId}`);

    await this.publishAccountUpdated(updated, userId);
    return this.toResponse(updated);
  }

  /**
   * Hard delete (design §4.2): transactions keep counting as spend with
   * `accountId` SetNull, imports and statement lines cascade — deliberate
   * "forget this account" semantics. Allowed while archived.
   */
  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.loadForManage(userId, id);

    await this.prisma.account.delete({ where: { id } });

    await this.writeAudit(userId, id, 'ACCOUNT_DELETED', {
      name: existing.name,
      kind: existing.kind,
      scopeType: existing.scopeType,
      groupId: existing.groupId,
    });
    this.logger.log(`Account ${id} deleted by user ${userId}`);

    await this.publishAccountUpdated(existing, userId);
  }

  async archive(userId: string, id: string): Promise<AccountResponseDto> {
    const existing = await this.loadForManage(userId, id);
    this.rejectArchived(existing, 'archive');

    const updated = await this.prisma.account.update({
      where: { id },
      data: { archivedAt: new Date() },
    });

    await this.writeAudit(userId, id, 'ACCOUNT_ARCHIVED', {});
    this.logger.log(`Account ${id} archived by user ${userId}`);

    await this.publishAccountUpdated(updated, userId);
    return this.toResponse(updated);
  }

  /** Idempotent — unarchiving an active account is a no-op (no audit/event). */
  async unarchive(userId: string, id: string): Promise<AccountResponseDto> {
    const existing = await this.loadForManage(userId, id);
    if (!existing.archivedAt) {
      return this.toResponse(existing);
    }

    const updated = await this.prisma.account.update({
      where: { id },
      data: { archivedAt: null },
    });

    await this.writeAudit(userId, id, 'ACCOUNT_UNARCHIVED', {});
    this.logger.log(`Account ${id} unarchived by user ${userId}`);

    await this.publishAccountUpdated(updated, userId);
    return this.toResponse(updated);
  }

  // ── access helpers ──

  /**
   * Fetch + read-access check: owner for personal, membership for group.
   * 404 (`ACCOUNT_NOT_FOUND`) on both "missing" and "not visible".
   *
   * Public since 20.4: importing a statement and deciding its lines is data
   * entry, open to every member, and both sibling services reach an account
   * through exactly this check.
   */
  async loadForRead(userId: string, id: string): Promise<AccountRow> {
    const account = await this.prisma.account.findFirst({
      where: { AND: [{ id }, buildAccountVisibilityWhere(userId)] },
    });
    if (!account) {
      throw new NotFoundException({
        message: 'Account not found',
        errorCode: ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND,
      });
    }
    return account;
  }

  /**
   * Fetch + mutate-access check. Personal → owner (else the read check 404s).
   * Group → member (else 404) AND admin (else the one deliberate 403,
   * `ACCOUNT_FORBIDDEN`, because members can see the account).
   */
  private async loadForManage(userId: string, id: string): Promise<AccountRow> {
    const account = await this.loadForRead(userId, id);
    if (account.scopeType === 'group' && account.groupId) {
      const membership = await this.prisma.groupMembership.findUnique({
        where: { groupId_userId: { groupId: account.groupId, userId } },
        select: { role: true },
      });
      if (membership?.role !== 'admin') {
        throw new ForbiddenException({
          message: 'Only group admins can manage group accounts',
          errorCode: ACCOUNT_ERRORS.ACCOUNT_FORBIDDEN,
        });
      }
    }
    return account;
  }

  /**
   * Create-time group guard. Non-members get 404 so group ids can't be
   * probed; members without the admin role get 403 `ACCOUNT_FORBIDDEN`.
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
        errorCode: ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
      });
    }
    if (membership.role !== 'admin') {
      throw new ForbiddenException({
        message: 'Only group admins can create group accounts',
        errorCode: ACCOUNT_ERRORS.ACCOUNT_FORBIDDEN,
      });
    }
    return membership.group.defaultCurrency;
  }

  // ── validation helpers ──

  /** The institution must issue accounts of this kind (`INSTITUTION_META`). */
  private validateInstitutionForKind(
    institution: AccountInstitution | null,
    kind: AccountKind,
  ): void {
    if (!institution) return;
    if (!INSTITUTION_META[institution].kinds.includes(kind)) {
      throw new BadRequestException({
        message: `Institution '${institution}' does not issue ${kind} accounts`,
        errorCode: ACCOUNT_ERRORS.ACCOUNT_INVALID_INSTITUTION,
      });
    }
  }

  /** Scope and currency are immutable after creation (design §6.1). */
  private rejectScopeChange(existing: AccountRow, dto: UpdateAccountDto): void {
    const changed =
      (dto.scopeType !== undefined && dto.scopeType !== existing.scopeType) ||
      (dto.groupId !== undefined && dto.groupId !== existing.groupId) ||
      (dto.currency !== undefined && dto.currency !== existing.currency);
    if (changed) {
      throw new BadRequestException({
        message: 'Scope and currency are immutable — recreate the account to move it',
        errorCode: ACCOUNT_ERRORS.ACCOUNT_INVALID_SCOPE,
      });
    }
  }

  /**
   * Card billing guard (design §2.4 / §6.1): billing fields are CARD-only,
   * `billingDay` requires `billingAccountId`, and the billing account must be
   * a visible, active BANK account in the same scope and currency — a card
   * can never bill itself. Every failure is one uniform 400
   * `ACCOUNT_INVALID_BILLING` (no existence leak on foreign accounts).
   */
  private async validateBilling(params: {
    userId: string;
    kind: AccountKind;
    currency: string;
    scopeType: 'personal' | 'group';
    ownerId: string | null;
    groupId: string | null;
    billingAccountId: string | null;
    billingDay: number | null;
    explicitBillingDay: boolean;
    selfId?: string;
  }): Promise<void> {
    const invalid = (message: string): never => {
      throw new BadRequestException({
        message,
        errorCode: ACCOUNT_ERRORS.ACCOUNT_INVALID_BILLING,
      });
    };

    if (params.kind !== 'CARD') {
      if (params.billingAccountId !== null || params.billingDay !== null) {
        invalid('Only CARD accounts carry a billing account and billing day');
      }
      return;
    }

    if (params.billingDay !== null && params.billingAccountId === null) {
      invalid('billingDay requires billingAccountId');
    }
    if (params.billingAccountId === null) return;
    if (params.selfId && params.selfId === params.billingAccountId) {
      invalid('A card cannot bill itself');
    }

    const billing = await this.prisma.account.findFirst({
      where: {
        AND: [{ id: params.billingAccountId }, buildAccountVisibilityWhere(params.userId)],
      },
      select: {
        kind: true,
        currency: true,
        archivedAt: true,
        scopeType: true,
        ownerId: true,
        groupId: true,
      },
    });

    const sameScope =
      !!billing &&
      billing.scopeType === params.scopeType &&
      (params.scopeType === 'personal'
        ? billing.ownerId === params.ownerId
        : billing.groupId === params.groupId);

    if (
      !billing ||
      !sameScope ||
      billing.kind !== 'BANK' ||
      billing.archivedAt !== null ||
      billing.currency !== params.currency
    ) {
      invalid(
        'billingAccountId must reference an active BANK account in the same scope and currency',
      );
    }
  }

  /** Archived accounts reject edit/archive; unarchive and delete stay possible. */
  private rejectArchived(account: AccountRow, operation: string): void {
    if (account.archivedAt) {
      throw new ConflictException({
        message: `Cannot ${operation} an archived account — unarchive it first`,
        errorCode: ACCOUNT_ERRORS.ACCOUNT_ARCHIVED,
      });
    }
  }

  // ── derived figures (design §2.2 / §2.3) ──

  private async toResponse(row: AccountRow): Promise<AccountResponseDto> {
    const derived = await this.deriveFigures([row]);
    return mapAccountToResponse(row, derived.get(row.id)!);
  }

  /**
   * Compute the ledger balance, pending-line count and reconciliation gap for
   * a page of accounts. Fixed query count regardless of page size: two
   * `groupBy` aggregates for the ledger (measured as of `ledgerBalanceAt`),
   * two more only when some account carries a bank figure (the gap is measured
   * as of `reportedBalanceAt`), and one count of pending statement lines.
   */
  private async deriveFigures(rows: AccountRow[]): Promise<Map<string, DerivedAccountFigures>> {
    const result = new Map<string, DerivedAccountFigures>();
    if (rows.length === 0) return result;

    const at = new Date();
    const ids = rows.map((r) => r.id);

    // The ledger is measured as of `at` — `ledgerBalanceAt` in the response —
    // so the figure a client shows always names the instant it is true for.
    const ledgerDeltas = await this.sumCountableDeltas(
      rows.map((r) => ({ accountId: r.id, from: r.openingBalanceAt, to: at })),
    );

    const gapRows = rows.filter((r) => r.reportedBalanceCents !== null);
    const gapDeltas = gapRows.length
      ? await this.sumCountableDeltas(
          gapRows.map((r) => ({
            accountId: r.id,
            from: r.openingBalanceAt,
            to: r.reportedBalanceAt ?? at,
          })),
        )
      : new Map<string, number>();

    const pendingLines = await this.prisma.accountStatementLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: ids }, status: 'PENDING' },
      _count: { _all: true },
    });
    const pendingByAccount = new Map(pendingLines.map((p) => [p.accountId, p._count._all]));

    for (const row of rows) {
      const ledgerBalanceCents = row.openingBalanceCents + (ledgerDeltas.get(row.id) ?? 0);
      const reconciliationGapCents =
        row.reportedBalanceCents === null
          ? null
          : row.reportedBalanceCents - (row.openingBalanceCents + (gapDeltas.get(row.id) ?? 0));
      result.set(row.id, {
        ledgerBalanceCents,
        ledgerBalanceAt: at.toISOString(),
        pendingLinesCount: pendingByAccount.get(row.id) ?? 0,
        reconciliationGapCents,
      });
    }
    return result;
  }

  /**
   * Σ of countable transactions per account over each account's own window
   * (design §2.2): rows on the account are `+amountCents` for IN and
   * `−amountCents` for OUT, rows pointing at it as a transfer destination are
   * `+amountCents`. Two `groupBy` queries for the whole page — never one per
   * account. "Countable" is `COUNTABLE_TRANSACTION_WHERE`, the same rule the
   * analytics `base` CTE applies in SQL.
   */
  private async sumCountableDeltas(windows: LedgerWindow[]): Promise<Map<string, number>> {
    const deltas = new Map<string, number>();
    if (windows.length === 0) return deltas;

    const occurredAt = (w: LedgerWindow): Prisma.DateTimeFilter => ({ gte: w.from, lt: w.to });

    const own = await this.prisma.transaction.groupBy({
      by: ['accountId', 'direction'],
      where: {
        ...COUNTABLE_TRANSACTION_WHERE,
        OR: windows.map((w) => ({ accountId: w.accountId, occurredAt: occurredAt(w) })),
      },
      _sum: { amountCents: true },
    });
    for (const row of own) {
      if (!row.accountId) continue;
      const sum = row._sum.amountCents ?? 0;
      const signed = row.direction === 'IN' ? sum : -sum;
      deltas.set(row.accountId, (deltas.get(row.accountId) ?? 0) + signed);
    }

    const incoming = await this.prisma.transaction.groupBy({
      by: ['transferAccountId'],
      where: {
        ...COUNTABLE_TRANSACTION_WHERE,
        OR: windows.map((w) => ({ transferAccountId: w.accountId, occurredAt: occurredAt(w) })),
      },
      _sum: { amountCents: true },
    });
    for (const row of incoming) {
      if (!row.transferAccountId) continue;
      const sum = row._sum.amountCents ?? 0;
      deltas.set(row.transferAccountId, (deltas.get(row.transferAccountId) ?? 0) + sum);
    }

    return deltas;
  }

  // ── side effects (shared with the import / statement-line services) ──

  private async publishAccountUpdated(account: AccountRow, actorId: string): Promise<void> {
    await publishAccountUpdated(this.prisma, this.eventBus, account, actorId);
  }

  private async writeAudit(
    userId: string,
    accountId: string,
    action: AccountAuditAction,
    details: Record<string, unknown>,
  ): Promise<void> {
    await writeAccountAudit(this.prisma, this.logger, {
      userId,
      action,
      entityId: accountId,
      details,
    });
  }
}
