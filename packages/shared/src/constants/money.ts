/**
 * Money limits shared by every app.
 *
 * All monetary amounts in this product are integer minor units (cents) stored
 * in MySQL `INT` columns — `transactions.amount_cents`, `accounts.*_balance_cents`,
 * `receipt_items.total_cents` and the rest. A signed `INT` tops out at
 * 2 147 483 647, so that is the real ceiling of every money field, and the API
 * must refuse anything above it rather than let the database truncate or throw.
 *
 * One constant, derived everywhere: a per-module cap that disagreed with the
 * column would either reject legal money or admit money the column cannot hold.
 */
export const MAX_MINOR_UNITS = 2_147_483_647;
