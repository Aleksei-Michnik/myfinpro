import {
  IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH,
  MAX_MINOR_UNITS,
  STATEMENT_DESCRIPTION_MAX_LENGTH,
  type ImportLineInput,
} from '@myfinpro/shared';
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
} from 'israeli-bank-scrapers/lib/transactions.js';
import { describe, expect, it } from 'vitest';
import {
  mapTransaction,
  mapTransactions,
  statementBalanceOf,
  toIsoDate,
  toLocalIsoDate,
} from './map.js';

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: '2026-09-03',
    processedDate: '2026-09-03',
    originalAmount: -100.5,
    originalCurrency: 'ILS',
    chargedAmount: -100.5,
    description: 'SUPER PHARM',
    status: TransactionStatuses.Completed,
    ...overrides,
  };
}

function line(overrides: Partial<Transaction> = {}): ImportLineInput {
  const mapped = mapTransaction(txn(overrides));
  if (typeof mapped === 'string') throw new Error(`unexpectedly skipped: ${mapped}`);
  return mapped;
}

describe('toIsoDate', () => {
  it('takes a bare calendar date as printed', () => {
    expect(toIsoDate('2026-09-03')).toBe('2026-09-03');
  });

  it('rejects an impossible date and unreadable text', () => {
    expect(toIsoDate('2026-02-31')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });

  it('reads an instant in the local timezone', () => {
    const local = new Date(2026, 8, 3, 13, 30);
    expect(toIsoDate(local.toISOString())).toBe('2026-09-03');
  });
});

describe('mapTransaction — the money', () => {
  it('takes direction and amount from chargedAmount', () => {
    expect(line({ chargedAmount: -100.5 })).toMatchObject({ direction: 'OUT', amountCents: 10050 });
    expect(line({ chargedAmount: 250 })).toMatchObject({ direction: 'IN', amountCents: 25000 });
  });

  it('ignores originalAmount as the mover of money', () => {
    const mapped = line({ chargedAmount: -40, originalAmount: -10, originalCurrency: 'USD' });
    expect(mapped.amountCents).toBe(4000);
    expect(mapped.direction).toBe('OUT');
  });

  it('skips a row that moves nothing or is unreadable', () => {
    expect(mapTransaction(txn({ chargedAmount: 0 }))).toBe('no_amount');
    expect(mapTransaction(txn({ chargedAmount: Number.NaN }))).toBe('no_amount');
  });

  it('skips an amount that cannot fit the contract', () => {
    expect(mapTransaction(txn({ chargedAmount: -(MAX_MINOR_UNITS / 100 + 1) }))).toBe(
      'amount_out_of_range',
    );
  });
});

describe('mapTransaction — dates', () => {
  it('maps date to postedAt and processedDate to valueAt when they differ', () => {
    const mapped = line({ date: '2026-09-01', processedDate: '2026-09-10' });
    expect(mapped.postedAt).toBe('2026-09-01');
    expect(mapped.valueAt).toBe('2026-09-10');
  });

  it('omits valueAt when the two dates are the same day', () => {
    expect(line({ date: '2026-09-03', processedDate: '2026-09-03' }).valueAt).toBeUndefined();
  });

  it('falls back to the processed date, and skips when neither is readable', () => {
    expect(line({ date: '', processedDate: '2026-09-10' }).postedAt).toBe('2026-09-10');
    expect(mapTransaction(txn({ date: 'xx', processedDate: 'yy' }))).toBe('invalid_date');
  });
});

describe('mapTransaction — text', () => {
  it('keeps the description and the memo apart', () => {
    const mapped = line({ description: 'SHUFERSAL DEAL', memo: 'branch 12' });
    expect(mapped.description).toBe('SHUFERSAL DEAL');
    expect(mapped.memo).toBe('branch 12');
  });

  it('drops a memo that only repeats the description', () => {
    expect(line({ description: 'Rami Levy', memo: 'rami levy' }).memo).toBeUndefined();
  });

  it('promotes the memo when the row has no description', () => {
    const mapped = line({ description: '', memo: 'הוראת קבע' });
    expect(mapped.description).toBe('הוראת קבע');
    expect(mapped.memo).toBeUndefined();
  });

  it('skips a row with no text at all', () => {
    expect(mapTransaction(txn({ description: '   ', memo: '' }))).toBe('missing_description');
  });

  it('cuts every text field to the column width', () => {
    const mapped = line({
      description: 'x'.repeat(400),
      identifier: '9'.repeat(100),
      category: 'c'.repeat(200),
    });
    expect(mapped.description).toHaveLength(STATEMENT_DESCRIPTION_MAX_LENGTH);
    expect(mapped.externalId).toHaveLength(IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH);
    expect(mapped.categoryHint).toHaveLength(100);
  });

  it('maps identifier, category and the missing balance', () => {
    const mapped = line({ identifier: 12345, category: 'Groceries' });
    expect(mapped.externalId).toBe('12345');
    expect(mapped.categoryHint).toBe('Groceries');
    expect(mapped.balanceAfterCents).toBeUndefined();
  });
});

describe('mapTransaction — currency and the foreign pair', () => {
  it('defaults to ILS and takes the account currency when given', () => {
    expect(line().currency).toBe('ILS');
    const mapped = mapTransaction(txn(), { currency: 'USD' });
    expect(typeof mapped === 'string' ? mapped : mapped.currency).toBe('USD');
  });

  it('prefers the row own charge currency', () => {
    expect(line({ chargedCurrency: 'EUR' }).currency).toBe('EUR');
  });

  it('keeps the purchase pair when the purchase currency differs', () => {
    const mapped = line({
      chargedAmount: -372.4,
      chargedCurrency: 'ILS',
      originalAmount: -99.9,
      originalCurrency: 'USD',
    });
    expect(mapped.originalAmountCents).toBe(9990);
    expect(mapped.originalCurrency).toBe('USD');
  });

  it('drops a same-currency pair, which carries nothing new', () => {
    const mapped = line({ chargedAmount: -50, originalAmount: -60, originalCurrency: 'ILS' });
    expect(mapped.originalAmountCents).toBeUndefined();
    expect(mapped.originalCurrency).toBeUndefined();
  });
});

describe('mapTransaction — installments and status', () => {
  it('maps an installment marker', () => {
    const mapped = line({
      type: TransactionTypes.Installments,
      installments: { number: 2, total: 6 },
    });
    expect(mapped.installmentNumber).toBe(2);
    expect(mapped.installmentTotal).toBe(6);
  });

  it('drops an impossible or oversized plan', () => {
    expect(line({ installments: { number: 7, total: 6 } }).installmentNumber).toBeUndefined();
    expect(line({ installments: { number: 1, total: 1000 } }).installmentTotal).toBeUndefined();
    expect(line({ installments: { number: 0, total: 6 } }).installmentNumber).toBeUndefined();
  });

  it('imports a line the bank still calls pending', () => {
    const mapped = mapTransactions([txn({ status: TransactionStatuses.Pending })]);
    expect(mapped.lines).toHaveLength(1);
    expect(mapped.pendingCount).toBe(1);
  });
});

describe('mapTransactions', () => {
  it('returns the lines oldest first and reports the skipped by index', () => {
    const result = mapTransactions([
      txn({ date: '2026-09-10', description: 'third' }),
      txn({ date: '2026-09-01', description: 'first' }),
      txn({ chargedAmount: 0, description: 'skipped' }),
      txn({ date: '2026-09-05', description: 'second' }),
    ]);

    expect(result.lines.map((item) => item.description)).toEqual(['first', 'second', 'third']);
    expect(result.skipped).toEqual([{ index: 2, reason: 'no_amount' }]);
    expect(result.pendingCount).toBe(0);
  });

  it('keeps the scraped order between rows of the same day', () => {
    const result = mapTransactions([
      txn({ date: '2026-09-01', description: 'a' }),
      txn({ date: '2026-09-01', description: 'b' }),
    ]);
    expect(result.lines.map((item) => item.description)).toEqual(['a', 'b']);
  });
});

describe('statementBalanceOf', () => {
  const NOW = new Date(2026, 8, 25, 9, 0);

  it('takes the balance and its own date', () => {
    expect(statementBalanceOf({ balance: 12345.67, balanceDate: '2026-09-24' }, NOW)).toEqual({
      statementBalanceCents: 1234567,
      statementBalanceAt: '2026-09-24',
    });
  });

  it('keeps a negative balance (an overdraft is a real balance)', () => {
    expect(statementBalanceOf({ balance: -250.5, balanceDate: '2026-09-24' }, NOW)).toMatchObject({
      statementBalanceCents: -25050,
    });
  });

  it('dates a balance with no date of its own as today', () => {
    expect(statementBalanceOf({ balance: 10 }, NOW)).toEqual({
      statementBalanceCents: 1000,
      statementBalanceAt: toLocalIsoDate(NOW),
    });
  });

  it('omits everything when the scraper reports no balance', () => {
    expect(statementBalanceOf({}, NOW)).toEqual({});
    expect(statementBalanceOf({ balance: Number.NaN }, NOW)).toEqual({});
  });

  it('omits a balance that does not fit the contract range', () => {
    expect(statementBalanceOf({ balance: MAX_MINOR_UNITS / 100 + 1 }, NOW)).toEqual({});
    expect(statementBalanceOf({ balance: -(MAX_MINOR_UNITS / 100 + 1) }, NOW)).toEqual({});
  });
});
