// Phase 20 · Iteration 20.7 — scraped transaction → `ImportLineInput`.
//
// The one place the library's shape meets the import contract (design §4.1,
// §6.2). Pure and total: a row that cannot become a legal line is SKIPPED with
// a reason and an index — never guessed at, never sent to be rejected as a 400
// that would take its whole chunk down with it.
//
// Rules (design §4, research note §2 and §5):
//   · `chargedAmount` moves the money: its sign is the direction, its absolute
//     value the amount. `originalAmount` never does — it is display only.
//   · `date` → `postedAt`, `processedDate` → `valueAt` when the two differ.
//   · a foreign purchase keeps its `originalAmount`/`originalCurrency` pair.
//   · `installments.number/total`, `category` → `categoryHint`,
//     `identifier` → `externalId`, `memo` → `memo`.
//   · `status: 'pending'` lines ARE imported: the bank posts them later and
//     the server's fingerprint dedups the repeat (design §2.5).
//   · no `balanceAfterCents` — the scrapers carry a balance per ACCOUNT, not
//     per transaction.

import {
  IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH,
  IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH,
  IMPORT_LINE_MAX_INSTALLMENTS,
  MAX_MINOR_UNITS,
  normalizeDescription,
  parseCurrencyCode,
  sanitizeStatementText,
  STATEMENT_DESCRIPTION_MAX_LENGTH,
  type ImportLineInput,
} from '@myfinpro/shared';
import {
  TransactionStatuses,
  type Transaction,
  type TransactionsAccount,
} from 'israeli-bank-scrapers/lib/transactions.js';

/** Currency assumed when neither the row nor the account states one. */
export const DEFAULT_CURRENCY = 'ILS';

/** Why a scraped row produced no line. Reported by index, never by content. */
export const MAP_SKIP_REASONS = [
  /** `chargedAmount` is zero, missing or not a finite number. */
  'no_amount',
  /** The amount does not fit the contract's integer minor-unit range. */
  'amount_out_of_range',
  /** Neither `date` nor `processedDate` could be read as a calendar date. */
  'invalid_date',
  /** Neither `description` nor `memo` carries any text. */
  'missing_description',
] as const;
export type MapSkipReason = (typeof MAP_SKIP_REASONS)[number];

export interface SkippedTransaction {
  /** 0-based index in the account's `txns` array. */
  index: number;
  reason: MapSkipReason;
}

export interface MappedTransactions {
  lines: ImportLineInput[];
  skipped: SkippedTransaction[];
  /** How many of the mapped lines the bank still calls pending. */
  pendingCount: number;
}

/**
 * The calendar date of a scraper date string.
 *
 * A bare `yyyy-mm-dd` is taken as printed. Anything with a time part (the
 * library's ISO strings) is read as an instant and formatted in the machine's
 * LOCAL timezone — the same convention the other tools on these scrapers use.
 * Running the connector on a machine set to Israel time therefore reproduces
 * the dates the bank shows; `doctor` warns when the timezone is not Israel's.
 */
export function toIsoDate(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bare) {
    const [year, month, day] = [Number(bare[1]), Number(bare[2]), Number(bare[3])];
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1) return null;
    return probe.getUTCDate() === day ? value : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : toLocalIsoDate(parsed);
}

/** `yyyy-mm-dd` of an instant in the machine's local timezone. */
export function toLocalIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function toCents(amount: number | undefined): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  return Number.isFinite(cents) ? cents : null;
}

function withinRange(cents: number): boolean {
  return cents >= 1 && cents <= MAX_MINOR_UNITS;
}

function currencyOf(raw: string | undefined, fallback: string): string {
  return (raw && parseCurrencyCode(raw)) || fallback;
}

export interface MapOptions {
  /**
   * The currency of the MyFinPro account the lines go to — used for rows the
   * scraper leaves without one. Defaults to ILS.
   */
  currency?: string;
}

/** Maps one scraped transaction, or returns the reason it cannot be mapped. */
export function mapTransaction(
  transaction: Transaction,
  options: MapOptions = {},
): ImportLineInput | MapSkipReason {
  const fallbackCurrency = currencyOf(options.currency, DEFAULT_CURRENCY);

  const chargedCents = toCents(transaction.chargedAmount);
  if (chargedCents === null || chargedCents === 0) return 'no_amount';
  const amountCents = Math.abs(chargedCents);
  if (!withinRange(amountCents)) return 'amount_out_of_range';

  const postedAt = toIsoDate(transaction.date) ?? toIsoDate(transaction.processedDate);
  if (!postedAt) return 'invalid_date';
  const processedAt = toIsoDate(transaction.processedDate);

  let description = sanitizeStatementText(
    transaction.description ?? '',
    STATEMENT_DESCRIPTION_MAX_LENGTH,
  );
  let memo = sanitizeStatementText(transaction.memo ?? '', STATEMENT_DESCRIPTION_MAX_LENGTH);
  if (!description) {
    // A row with only a memo still describes a real charge: promote it, so it
    // is not dropped and so the fingerprint has something to hash.
    description = memo;
    memo = '';
  }
  if (!description) return 'missing_description';
  if (memo && normalizeDescription(memo) === normalizeDescription(description)) memo = '';

  const currency = currencyOf(transaction.chargedCurrency, fallbackCurrency);
  const line: ImportLineInput = {
    postedAt,
    amountCents,
    direction: chargedCents < 0 ? 'OUT' : 'IN',
    currency,
    description,
  };

  if (processedAt && processedAt !== postedAt) line.valueAt = processedAt;
  if (memo) line.memo = memo;

  const externalId = sanitizeStatementText(
    transaction.identifier === undefined || transaction.identifier === null
      ? ''
      : String(transaction.identifier),
    IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH,
  );
  if (externalId) line.externalId = externalId;

  // Foreign purchase: the charge is in the account's currency, the purchase is
  // not. Same-currency pairs carry no information the charge does not.
  const originalCurrency = transaction.originalCurrency
    ? parseCurrencyCode(transaction.originalCurrency)
    : null;
  if (originalCurrency && originalCurrency !== currency) {
    const originalCents = toCents(transaction.originalAmount);
    if (originalCents !== null && withinRange(Math.abs(originalCents))) {
      line.originalAmountCents = Math.abs(originalCents);
      line.originalCurrency = originalCurrency;
    }
  }

  const installments = transaction.installments;
  if (
    installments &&
    Number.isInteger(installments.number) &&
    Number.isInteger(installments.total) &&
    installments.number >= 1 &&
    installments.total >= installments.number &&
    installments.total <= IMPORT_LINE_MAX_INSTALLMENTS
  ) {
    line.installmentNumber = installments.number;
    line.installmentTotal = installments.total;
  }

  const categoryHint = sanitizeStatementText(
    transaction.category ?? '',
    IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH,
  );
  if (categoryHint) line.categoryHint = categoryHint;

  return line;
}

function isSkipReason(value: ImportLineInput | MapSkipReason): value is MapSkipReason {
  return typeof value === 'string';
}

/**
 * Maps a scraped account's transactions, oldest first — the order the server
 * hashes as the ordinal tie-breaker of a fingerprint, so a re-run of the same
 * period produces the same fingerprints and counts as duplicates.
 */
export function mapTransactions(
  transactions: readonly Transaction[],
  options: MapOptions = {},
): MappedTransactions {
  const result: MappedTransactions = { lines: [], skipped: [], pendingCount: 0 };

  const ordered = transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((left, right) => {
      const leftDate = toIsoDate(left.transaction.date) ?? '';
      const rightDate = toIsoDate(right.transaction.date) ?? '';
      return leftDate === rightDate ? left.index - right.index : leftDate < rightDate ? -1 : 1;
    });

  for (const { transaction, index } of ordered) {
    const mapped = mapTransaction(transaction, options);
    if (isSkipReason(mapped)) {
      result.skipped.push({ index, reason: mapped });
      continue;
    }
    result.lines.push(mapped);
    if (transaction.status === TransactionStatuses.Pending) result.pendingCount += 1;
  }

  return result;
}

/**
 * The statement balance of a scraped account, in the shape
 * `POST /accounts/:id/imports` takes (design §2.3, §6.2).
 *
 * The scrapers report a balance per ACCOUNT, not per row, so it describes the
 * whole statement — the connector sends it with the LAST chunk only, exactly
 * as the web import wizard does. A balance with no date of its own is dated
 * today: it is what the bank showed at the moment of this scrape, and the API
 * only moves the account's reported balance when a date comes with it.
 *
 * Returns an empty object when the scraper reported no balance or one that
 * does not fit the contract's range — the import then simply carries none.
 */
export function statementBalanceOf(
  account: Pick<TransactionsAccount, 'balance' | 'balanceDate'>,
  now: Date = new Date(),
): { statementBalanceCents?: number; statementBalanceAt?: string } {
  const cents = toCents(account.balance);
  if (cents === null || Math.abs(cents) > MAX_MINOR_UNITS) return {};
  return {
    statementBalanceCents: cents,
    statementBalanceAt: toIsoDate(account.balanceDate) ?? toLocalIsoDate(now),
  };
}
