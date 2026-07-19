import { Prisma } from '@prisma/client';
import { attributionScopePredicate, type VerifiedScope } from './analytics-visibility.sql';

/** Base-transaction filters (design §2.2, §2.5). */
export interface PurchaseRowsParams {
  userId: string;
  direction: 'IN' | 'OUT';
  dateFrom?: Date;
  dateTo?: Date;
  currencies?: string[];
  memberIds?: string[];
  /** Membership-verified scope narrowing; absent = full visibility. */
  scopes?: VerifiedScope[];
}

/**
 * The hybrid-grain `WITH … purchase_rows` prefix (design §2.1).
 *
 * - `base`: countable (`POSTED` + `ONE_TIME`), visible, filter-matching
 *   transactions. Recurring/plan parents are templates and never match.
 * - `item_totals`: Σ item cents per base transaction with a CONFIRMED
 *   receipt (receipts.transaction_id is unique — no fan-out).
 * - `purchase_rows`: three UNION ALL arms — item rows, balancing rows
 *   (header amount − item sum, when they differ), and header rows for
 *   transactions without confirmed items. Guarantees
 *   Σ(purchase_rows.amount_cents) ≡ Σ(base.amount_cents).
 *
 * Columns: txn_id, currency, occurred_at, created_by_id, amount_cents,
 * category_id (effective — item category with header fallback), product_id,
 * merchant_id, is_item.
 */
export function purchaseRowsCte(params: PurchaseRowsParams): Prisma.Sql {
  const scopePredicate = attributionScopePredicate(params.userId, params.scopes);

  const dateFromClause = params.dateFrom
    ? Prisma.sql`AND t.occurred_at >= ${params.dateFrom}`
    : Prisma.empty;
  const dateToClause = params.dateTo
    ? Prisma.sql`AND t.occurred_at < ${params.dateTo}`
    : Prisma.empty;
  const currencyClause =
    params.currencies && params.currencies.length > 0
      ? Prisma.sql`AND t.currency IN (${Prisma.join(params.currencies)})`
      : Prisma.empty;
  const memberClause =
    params.memberIds && params.memberIds.length > 0
      ? Prisma.sql`AND t.created_by_id IN (${Prisma.join(params.memberIds)})`
      : Prisma.empty;

  return Prisma.sql`WITH base AS (
  SELECT t.id, t.amount_cents, t.currency, t.occurred_at, t.category_id, t.created_by_id
  FROM transactions t
  WHERE t.status = 'POSTED' AND t.type = 'ONE_TIME'
    AND t.direction = ${params.direction}
    ${dateFromClause}
    ${dateToClause}
    ${currencyClause}
    ${memberClause}
    AND EXISTS (
      SELECT 1 FROM transaction_attributions a
      WHERE a.transaction_id = t.id AND ${scopePredicate}
    )
),
item_totals AS (
  SELECT r.transaction_id AS txn_id, CAST(SUM(ri.total_cents) AS SIGNED) AS items_total
  FROM base b
  JOIN receipts r ON r.transaction_id = b.id AND r.status = 'CONFIRMED'
  JOIN receipt_items ri ON ri.receipt_id = r.id
  GROUP BY r.transaction_id
),
purchase_rows AS (
  SELECT b.id AS txn_id, b.currency, b.occurred_at, b.created_by_id,
         ri.total_cents AS amount_cents,
         COALESCE(ri.category_id, b.category_id) AS category_id,
         ri.product_id AS product_id,
         r.merchant_id AS merchant_id,
         1 AS is_item
  FROM base b
  JOIN receipts r ON r.transaction_id = b.id AND r.status = 'CONFIRMED'
  JOIN receipt_items ri ON ri.receipt_id = r.id
  UNION ALL
  SELECT b.id, b.currency, b.occurred_at, b.created_by_id,
         b.amount_cents - it.items_total,
         b.category_id, NULL, r.merchant_id, 0
  FROM base b
  JOIN receipts r ON r.transaction_id = b.id AND r.status = 'CONFIRMED'
  JOIN item_totals it ON it.txn_id = b.id
  WHERE b.amount_cents <> it.items_total
  UNION ALL
  SELECT b.id, b.currency, b.occurred_at, b.created_by_id,
         b.amount_cents, b.category_id, NULL, r.merchant_id, 0
  FROM base b
  LEFT JOIN receipts r ON r.transaction_id = b.id AND r.status = 'CONFIRMED'
  WHERE NOT EXISTS (SELECT 1 FROM item_totals it2 WHERE it2.txn_id = b.id)
)`;
}
