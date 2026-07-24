import {
  ANALYTICS_MAX_GROUPS,
  PAGINATION_DEFAULTS,
  decodeCursor,
  encodeCursor,
  type AnalyticsResultKeys,
  type AnalyticsResultRow,
  type PaginatedResponseDto,
} from '@myfinpro/shared';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ANALYTICS_ERRORS } from '../constants/analytics-errors';
import type { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { attributionScopePredicate, type VerifiedScope } from './analytics-visibility.sql';
import { dimensionSelects, needsAttributionJoin, type DimensionSelect } from './dimension-sql';
import { purchaseRowsCte } from './purchase-rows.sql';
import { queryFingerprint, utcOffsetString } from './query-fingerprint';

/** Raw shape of one aggregate row as returned by $queryRaw. */
type RawRow = Record<string, unknown>;

/** mysql2 returns BIGINT casts as BigInt and may return DECIMAL as string. */
function toNum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(String(value));
}

/**
 * The Phase 9 aggregation engine (design §2, §6): composes the hybrid-grain
 * purchase-row SQL, executes it, and maps buckets to `AnalyticsResultRow`s.
 *
 * Reused by the controller today and by merchant/price/habit services and
 * the Phase 11 MCP tools later — keep this the single entry point.
 */
@Injectable()
export class AnalyticsEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async runQuery(
    userId: string,
    dto: AnalyticsQueryDto,
  ): Promise<PaginatedResponseDto<AnalyticsResultRow>> {
    this.validateSemantics(dto);
    const scopes = await this.verifyScopes(userId, dto);
    const offset = this.resolveOffset(dto);
    const limit = dto.limit ?? PAGINATION_DEFAULTS.DEFAULT_LIMIT;

    if (offset + limit > ANALYTICS_MAX_GROUPS) {
      throw new BadRequestException({
        message: `Result window exceeds the ${ANALYTICS_MAX_GROUPS}-group cap`,
        errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      });
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });

    const sql = this.composeSql(userId, dto, scopes, user, limit, offset);
    const raw = await this.prisma.$queryRaw<RawRow[]>(sql);

    const hasMore = raw.length > limit;
    const page = hasMore ? raw.slice(0, limit) : raw;
    const data = await this.mapRows(dto, page);

    return {
      data,
      cursor: hasMore ? encodeCursor({ o: offset + limit, f: queryFingerprint({ ...dto }) }) : null,
      hasMore,
    };
  }

  // ── validation ──

  private validateSemantics(dto: AnalyticsQueryDto): void {
    const hasPeriod = dto.dimensions.includes('period');
    if (hasPeriod && !dto.granularity) {
      throw new BadRequestException({
        message: "granularity is required when dimensions include 'period'",
        errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      });
    }
    if (!hasPeriod && dto.granularity) {
      throw new BadRequestException({
        message: "granularity is only valid with the 'period' dimension",
        errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      });
    }
    if (dto.dimensions.includes('scope') && dto.dimensions.includes('group')) {
      throw new BadRequestException({
        message: "dimensions 'scope' and 'group' are mutually exclusive",
        errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      });
    }

    const { dateFrom, dateTo, scopes } = dto.filters ?? {};
    if (dateFrom && dateTo && new Date(dateFrom) >= new Date(dateTo)) {
      throw new BadRequestException({
        message: 'dateFrom must be strictly before dateTo',
        errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      });
    }
    for (const s of scopes ?? []) {
      if (s.scope === 'group' && !s.groupId) {
        throw new BadRequestException({
          message: 'scope=group filter entries require a groupId',
          errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
        });
      }
      if (s.scope === 'personal' && s.groupId) {
        throw new BadRequestException({
          message: 'scope=personal filter entries must not carry a groupId',
          errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
        });
      }
    }
  }

  /** 403 when a scope filter names a group the caller is not a member of. */
  private async verifyScopes(
    userId: string,
    dto: AnalyticsQueryDto,
  ): Promise<VerifiedScope[] | undefined> {
    const scopes = dto.filters?.scopes;
    if (!scopes || scopes.length === 0) return undefined;

    const groupIds = scopes.filter((s) => s.scope === 'group').map((s) => s.groupId as string);
    if (groupIds.length > 0) {
      const memberships = await this.prisma.groupMembership.findMany({
        where: { userId, groupId: { in: groupIds } },
        select: { groupId: true },
      });
      const memberOf = new Set(memberships.map((m) => m.groupId));
      const denied = groupIds.find((id) => !memberOf.has(id));
      if (denied) {
        throw new ForbiddenException({
          message: 'Requested group scope is not accessible',
          errorCode: ANALYTICS_ERRORS.ANALYTICS_SCOPE_FORBIDDEN,
        });
      }
    }
    return scopes.map((s) => ({ scope: s.scope, groupId: s.groupId }));
  }

  private resolveOffset(dto: AnalyticsQueryDto): number {
    if (!dto.cursor) return 0;
    let decoded: Record<string, unknown>;
    try {
      decoded = decodeCursor(dto.cursor);
    } catch {
      throw new BadRequestException({
        message: 'Malformed cursor',
        errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_CURSOR,
      });
    }
    if (decoded.f !== queryFingerprint({ ...dto }) || typeof decoded.o !== 'number') {
      throw new BadRequestException({
        message: 'Cursor does not match this query',
        errorCode: ANALYTICS_ERRORS.ANALYTICS_INVALID_CURSOR,
      });
    }
    return decoded.o;
  }

  // ── SQL composition ──

  private composeSql(
    userId: string,
    dto: AnalyticsQueryDto,
    scopes: VerifiedScope[] | undefined,
    user: { timezone: string | null; defaultCurrency: string | null },
    limit: number,
    offset: number,
  ): Prisma.Sql {
    const filters = dto.filters ?? {};
    const utcOffset = utcOffsetString(user.timezone ?? 'UTC', new Date());

    const cte = purchaseRowsCte({
      userId,
      direction: filters.direction ?? 'OUT',
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
      currencies: filters.currencies,
      memberIds: filters.memberIds,
      scopes,
    });

    const selects: DimensionSelect[] = dto.dimensions.flatMap((d) =>
      dimensionSelects(d, { granularity: dto.granularity, utcOffset }),
    );
    const selectList =
      selects.length > 0
        ? Prisma.sql`${Prisma.join(
            selects.map((s) => Prisma.sql`${s.expr} AS ${Prisma.raw(s.alias)}`),
            ', ',
          )}, `
        : Prisma.empty;

    const join = needsAttributionJoin(dto.dimensions)
      ? Prisma.sql`JOIN transaction_attributions a
          ON a.transaction_id = p.txn_id AND ${attributionScopePredicate(userId, scopes)}`
      : Prisma.empty;

    const rowFilters: Prisma.Sql[] = [];
    if (filters.categoryIds?.length) {
      rowFilters.push(Prisma.sql`p.category_id IN (${Prisma.join(filters.categoryIds)})`);
    }
    if (filters.merchantIds?.length) {
      rowFilters.push(Prisma.sql`p.merchant_id IN (${Prisma.join(filters.merchantIds)})`);
    }
    if (filters.productIds?.length) {
      rowFilters.push(Prisma.sql`p.product_id IN (${Prisma.join(filters.productIds)})`);
    }
    const where =
      rowFilters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(rowFilters, ' AND ')}` : Prisma.empty;

    // GROUP BY references the SELECT aliases, never the expressions: an
    // expression with a bound placeholder (the period offset) would bind a
    // SECOND parameter in GROUP BY, which ONLY_FULL_GROUP_BY then treats as
    // a different, non-grouped expression (MySQL error 1055).
    const groupExprs = [...selects.map((s) => Prisma.raw(s.alias)), Prisma.sql`p.currency`];
    const orderBy = this.orderBy(dto, selects, user.defaultCurrency ?? 'USD');

    return Prisma.sql`${cte}
SELECT ${selectList}p.currency AS currency,
       CAST(SUM(p.amount_cents) AS SIGNED) AS spend_cents,
       CAST(COUNT(DISTINCT p.txn_id) AS SIGNED) AS transaction_count,
       CAST(SUM(p.is_item) AS SIGNED) AS item_count
FROM purchase_rows p
${join}
${where}
GROUP BY ${Prisma.join(groupExprs, ', ')}
ORDER BY ${orderBy}
LIMIT ${limit + 1} OFFSET ${offset}`;
  }

  /**
   * Deterministic ordering (design §6): requested sort first, then default
   * currency preference, then every dimension key + currency as tiebreakers —
   * offset-cursor pages stay stable for a fixed dataset.
   */
  private orderBy(
    dto: AnalyticsQueryDto,
    selects: DimensionSelect[],
    defaultCurrency: string,
  ): Prisma.Sql {
    const dir = dto.sort?.dir === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC');
    // Aliases, not expressions — same ONLY_FULL_GROUP_BY reasoning as the
    // GROUP BY list in composeSql().
    const keyAliases = selects.map((s) => Prisma.raw(s.alias));

    const terms: Prisma.Sql[] = [];
    switch (dto.sort?.by ?? 'spend') {
      case 'spend':
        terms.push(Prisma.sql`spend_cents ${dir}`);
        break;
      case 'count':
        terms.push(Prisma.sql`transaction_count ${dir}`);
        break;
      case 'key':
        for (const alias of keyAliases) terms.push(Prisma.sql`${alias} ${dir}`);
        break;
    }
    terms.push(Prisma.sql`(p.currency = ${defaultCurrency}) DESC`);
    for (const alias of keyAliases) terms.push(Prisma.sql`${alias} ASC`);
    terms.push(Prisma.sql`p.currency ASC`);
    return Prisma.join(terms, ', ');
  }

  // ── row mapping ──

  private async mapRows(dto: AnalyticsQueryDto, rows: RawRow[]): Promise<AnalyticsResultRow[]> {
    const names = await this.resolveNames(dto, rows);

    return rows.map((row) => {
      const keys: AnalyticsResultKeys = {};
      for (const dimension of dto.dimensions) {
        switch (dimension) {
          case 'category':
            keys.category = this.keyRef(row.k_category, names.category);
            break;
          case 'merchant':
            keys.merchant = this.keyRef(row.k_merchant, names.merchant);
            break;
          case 'product':
            keys.product = this.keyRef(row.k_product, names.product);
            break;
          case 'member':
            keys.member = this.keyRef(row.k_member, names.member);
            break;
          case 'group':
            keys.group = this.keyRef(row.k_group, names.group);
            break;
          case 'scope':
            keys.scope =
              row.k_scope_type === 'group'
                ? { scopeType: 'group', group: this.keyRef(row.k_scope_group, names.group) }
                : { scopeType: 'personal' };
            break;
          case 'period':
            keys.period = String(row.k_period);
            break;
        }
      }
      return {
        keys,
        currency: String(row.currency),
        spendCents: toNum(row.spend_cents),
        transactionCount: toNum(row.transaction_count),
        itemCount: toNum(row.item_count),
      };
    });
  }

  private keyRef(
    id: unknown,
    names: Map<string, string>,
  ): { id: string | null; name: string | null } {
    if (id === null || id === undefined) return { id: null, name: null };
    const key = String(id);
    return { id: key, name: names.get(key) ?? null };
  }

  /** Batch-resolve display names for the ids on this page (design §6). */
  private async resolveNames(
    dto: AnalyticsQueryDto,
    rows: RawRow[],
  ): Promise<
    Record<'category' | 'merchant' | 'product' | 'member' | 'group', Map<string, string>>
  > {
    const collect = (...aliases: string[]): string[] => {
      const ids = new Set<string>();
      for (const row of rows) {
        for (const alias of aliases) {
          const v = row[alias];
          if (v !== null && v !== undefined) ids.add(String(v));
        }
      }
      return [...ids];
    };

    const categoryIds = dto.dimensions.includes('category') ? collect('k_category') : [];
    const merchantIds = dto.dimensions.includes('merchant') ? collect('k_merchant') : [];
    const productIds = dto.dimensions.includes('product') ? collect('k_product') : [];
    const memberIds = dto.dimensions.includes('member') ? collect('k_member') : [];
    const groupIds = collect('k_group', 'k_scope_group');

    const [categories, merchants, products, members, groups] = await Promise.all([
      categoryIds.length
        ? this.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : [],
      merchantIds.length
        ? this.prisma.merchant.findMany({
            where: { id: { in: merchantIds } },
            select: { id: true, name: true },
          })
        : [],
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : [],
      memberIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: memberIds } },
            select: { id: true, name: true },
          })
        : [],
      groupIds.length
        ? this.prisma.group.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const toMap = (list: { id: string; name: string }[]) =>
      new Map(list.map((x) => [x.id, x.name]));
    return {
      category: toMap(categories),
      merchant: toMap(merchants),
      product: toMap(products),
      member: toMap(members),
      group: toMap(groups),
    };
  }
}
