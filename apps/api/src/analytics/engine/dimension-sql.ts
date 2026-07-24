import type { AnalyticsDimension, AnalyticsGranularity } from '@myfinpro/shared';
import { Prisma } from '@prisma/client';

/**
 * Dimension → SQL expression map (design §2.5). Identifiers and aliases are
 * compile-time constants from this module — user input selects map entries
 * but never becomes SQL text.
 *
 * Expressions read from `purchase_rows p` and, for scope/group, the joined
 * `transaction_attributions a` (attribution-join mode, design §2.3).
 */

export interface DimensionSelect {
  /** SELECT expression. */
  expr: Prisma.Sql;
  /** Stable alias, also used in GROUP BY / ORDER BY (MySQL permits both). */
  alias: string;
}

/** Dimensions that require joining `transaction_attributions` (design §2.3). */
export function needsAttributionJoin(dimensions: AnalyticsDimension[]): boolean {
  return dimensions.includes('scope') || dimensions.includes('group');
}

/**
 * SELECT list entries for one dimension. `scope` is the only dimension that
 * produces two columns (scope_type + group id).
 */
export function dimensionSelects(
  dimension: AnalyticsDimension,
  options: { granularity?: AnalyticsGranularity; utcOffset?: string },
): DimensionSelect[] {
  switch (dimension) {
    case 'category':
      return [{ expr: Prisma.sql`p.category_id`, alias: 'k_category' }];
    case 'merchant':
      return [{ expr: Prisma.sql`p.merchant_id`, alias: 'k_merchant' }];
    case 'product':
      return [{ expr: Prisma.sql`p.product_id`, alias: 'k_product' }];
    case 'member':
      return [{ expr: Prisma.sql`p.created_by_id`, alias: 'k_member' }];
    case 'group':
      return [{ expr: Prisma.sql`a.group_id`, alias: 'k_group' }];
    case 'scope':
      return [
        { expr: Prisma.sql`a.scope_type`, alias: 'k_scope_type' },
        { expr: Prisma.sql`a.group_id`, alias: 'k_scope_group' },
      ];
    case 'period':
      return [
        {
          expr: periodExpression(
            options.granularity as AnalyticsGranularity,
            options.utcOffset ?? '+00:00',
          ),
          alias: 'k_period',
        },
      ];
  }
}

/**
 * Period bucket key in the user's timezone (fixed per-query offset —
 * design §2.5). Formats sort lexicographically within a granularity:
 * '2026-06-15' | '2026-W24' | '2026-06' | '2026-Q2' | '2026'.
 */
function periodExpression(granularity: AnalyticsGranularity, utcOffset: string): Prisma.Sql {
  const local = Prisma.sql`CONVERT_TZ(p.occurred_at, '+00:00', ${utcOffset})`;
  switch (granularity) {
    case 'day':
      return Prisma.sql`DATE_FORMAT(${local}, '%Y-%m-%d')`;
    case 'week':
      // %x-%v = ISO week-year + zero-padded ISO week.
      return Prisma.sql`DATE_FORMAT(${local}, '%x-W%v')`;
    case 'month':
      return Prisma.sql`DATE_FORMAT(${local}, '%Y-%m')`;
    case 'quarter':
      return Prisma.sql`CONCAT(YEAR(${local}), '-Q', QUARTER(${local}))`;
    case 'year':
      return Prisma.sql`DATE_FORMAT(${local}, '%Y')`;
  }
}
