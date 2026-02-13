/**
 * Currency types and utilities.
 *
 * All monetary amounts are stored as integer cents (minor units).
 * Currency formatting uses Intl.NumberFormat (no external dependencies).
 */

/** ISO 4217 currency codes (commonly used subset) */
export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'ILS'
  | 'JPY'
  | 'CAD'
  | 'AUD'
  | 'CHF'
  | 'CNY'
  | 'RUB';

/** Money representation — amount stored as integer minor units (cents) */
export interface Money {
  /** Amount in minor units (e.g., 1050 = $10.50 for USD) */
  amount: number;
  /** ISO 4217 currency code */
  currency: CurrencyCode;
}

/** Metadata for a currency */
export interface CurrencyInfo {
  /** ISO 4217 code */
  code: CurrencyCode;
  /** Full currency name in English */
  name: string;
  /** Currency symbol */
  symbol: string;
  /** Number of decimal places (2 for most, 0 for JPY) */
  decimals: number;
  /** Whether symbol appears before or after the amount */
  symbolPosition: 'before' | 'after';
}

/** Registry of supported currencies with metadata */
export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, symbolPosition: 'before' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, symbolPosition: 'before' },
  GBP: {
    code: 'GBP',
    name: 'British Pound',
    symbol: '£',
    decimals: 2,
    symbolPosition: 'before',
  },
  ILS: {
    code: 'ILS',
    name: 'Israeli New Shekel',
    symbol: '₪',
    decimals: 2,
    symbolPosition: 'before',
  },
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, symbolPosition: 'before' },
  CAD: {
    code: 'CAD',
    name: 'Canadian Dollar',
    symbol: 'CA$',
    decimals: 2,
    symbolPosition: 'before',
  },
  AUD: {
    code: 'AUD',
    name: 'Australian Dollar',
    symbol: 'A$',
    decimals: 2,
    symbolPosition: 'before',
  },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2, symbolPosition: 'before' },
  CNY: {
    code: 'CNY',
    name: 'Chinese Yuan',
    symbol: '¥',
    decimals: 2,
    symbolPosition: 'before',
  },
  RUB: { code: 'RUB', name: 'Russian Ruble', symbol: '₽', decimals: 2, symbolPosition: 'after' },
};

/** Array of all supported currency codes (for runtime iteration) */
export const CURRENCY_CODES: CurrencyCode[] = Object.keys(CURRENCIES) as CurrencyCode[];

/**
 * Convert cents (minor units) to a decimal number.
 * @param cents - Integer amount in minor units
 * @param decimals - Number of decimal places (default: 2)
 * @returns Decimal representation (e.g., 1050 → 10.50)
 */
export function centsToDecimal(cents: number, decimals = 2): number {
  if (decimals === 0) return cents;
  return cents / Math.pow(10, decimals);
}

/**
 * Convert a decimal amount to cents (minor units).
 * Uses rounding to avoid floating-point precision issues.
 * @param amount - Decimal amount (e.g., 10.50)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Integer amount in minor units (e.g., 1050)
 */
export function decimalToCents(amount: number, decimals = 2): number {
  if (decimals === 0) return Math.round(amount);
  return Math.round(amount * Math.pow(10, decimals));
}

/**
 * Format a Money value for display using Intl.NumberFormat.
 * @param money - Money object with amount in minor units and currency code
 * @param locale - BCP 47 locale string (default: 'en-US')
 * @returns Formatted currency string (e.g., '$10.50')
 */
export function formatMoney(money: Money, locale = 'en-US'): string {
  const info = CURRENCIES[money.currency];
  if (!info) {
    throw new Error(`Unsupported currency: ${money.currency}`);
  }
  const decimalAmount = centsToDecimal(money.amount, info.decimals);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: info.decimals,
    maximumFractionDigits: info.decimals,
  }).format(decimalAmount);
}
