import { describe, it, expect } from 'vitest';

import {
  CURRENCIES,
  CURRENCY_CODES,
  centsToDecimal,
  decimalToCents,
  formatMoney,
} from '../types/currency.types';
import type { CurrencyCode, Money } from '../types/currency.types';

describe('Currency Types', () => {
  describe('CURRENCIES registry', () => {
    it('should contain all expected currency codes', () => {
      const expectedCodes: CurrencyCode[] = [
        'USD',
        'EUR',
        'GBP',
        'ILS',
        'JPY',
        'CAD',
        'AUD',
        'CHF',
        'CNY',
        'RUB',
      ];
      for (const code of expectedCodes) {
        expect(CURRENCIES[code]).toBeDefined();
        expect(CURRENCIES[code].code).toBe(code);
      }
    });

    it('should have correct decimals for JPY (0)', () => {
      expect(CURRENCIES.JPY.decimals).toBe(0);
    });

    it('should have correct decimals for USD (2)', () => {
      expect(CURRENCIES.USD.decimals).toBe(2);
    });

    it('should have names and symbols for all currencies', () => {
      for (const code of CURRENCY_CODES) {
        const info = CURRENCIES[code];
        expect(info.name).toBeTruthy();
        expect(info.symbol).toBeTruthy();
        expect(['before', 'after']).toContain(info.symbolPosition);
      }
    });
  });

  describe('CURRENCY_CODES', () => {
    it('should be an array of all currency codes', () => {
      expect(CURRENCY_CODES).toHaveLength(Object.keys(CURRENCIES).length);
      for (const code of CURRENCY_CODES) {
        expect(CURRENCIES[code]).toBeDefined();
      }
    });
  });

  describe('centsToDecimal', () => {
    it('should convert 1050 cents to 10.50 (2 decimals)', () => {
      expect(centsToDecimal(1050)).toBe(10.5);
    });

    it('should convert 100 cents to 1.00', () => {
      expect(centsToDecimal(100)).toBe(1);
    });

    it('should convert 0 cents to 0', () => {
      expect(centsToDecimal(0)).toBe(0);
    });

    it('should convert negative cents', () => {
      expect(centsToDecimal(-500)).toBe(-5);
    });

    it('should handle 0 decimals (JPY-like)', () => {
      expect(centsToDecimal(1050, 0)).toBe(1050);
    });

    it('should handle 3 decimals', () => {
      expect(centsToDecimal(1050, 3)).toBe(1.05);
    });
  });

  describe('decimalToCents', () => {
    it('should convert 10.50 to 1050 cents', () => {
      expect(decimalToCents(10.5)).toBe(1050);
    });

    it('should convert 1.00 to 100 cents', () => {
      expect(decimalToCents(1)).toBe(100);
    });

    it('should convert 0 to 0', () => {
      expect(decimalToCents(0)).toBe(0);
    });

    it('should convert negative amounts', () => {
      expect(decimalToCents(-5)).toBe(-500);
    });

    it('should handle 0 decimals (JPY-like)', () => {
      expect(decimalToCents(1050, 0)).toBe(1050);
    });

    it('should round to avoid floating-point issues', () => {
      // 0.1 + 0.2 = 0.30000000000000004 in floating-point
      expect(decimalToCents(0.1 + 0.2)).toBe(30);
    });
  });

  describe('formatMoney', () => {
    it('should format USD amount', () => {
      const money: Money = { amount: 1050, currency: 'USD' };
      const formatted = formatMoney(money, 'en-US');
      expect(formatted).toContain('10');
      expect(formatted).toContain('50');
    });

    it('should format JPY amount (0 decimals)', () => {
      const money: Money = { amount: 1000, currency: 'JPY' };
      const formatted = formatMoney(money, 'en-US');
      expect(formatted).toContain('1,000');
    });

    it('should format EUR amount', () => {
      const money: Money = { amount: 2500, currency: 'EUR' };
      const formatted = formatMoney(money, 'en-US');
      expect(formatted).toContain('25');
    });

    it('should use en-US as default locale', () => {
      const money: Money = { amount: 1050, currency: 'USD' };
      const formatted = formatMoney(money);
      expect(formatted).toContain('10');
    });

    it('should throw for unsupported currency', () => {
      const money = { amount: 100, currency: 'XYZ' as CurrencyCode };
      expect(() => formatMoney(money)).toThrow('Unsupported currency');
    });

    it('should format zero amounts', () => {
      const money: Money = { amount: 0, currency: 'USD' };
      const formatted = formatMoney(money, 'en-US');
      expect(formatted).toContain('0');
    });

    it('should format negative amounts', () => {
      const money: Money = { amount: -1050, currency: 'USD' };
      const formatted = formatMoney(money, 'en-US');
      expect(formatted).toContain('10');
    });
  });
});
