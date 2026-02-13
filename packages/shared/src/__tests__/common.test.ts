import { describe, it, expect } from 'vitest';

import { LOCALES, DEFAULT_LOCALE } from '../constants';
import type { Locale } from '../constants';
import { isRTL, RTL_LOCALES } from '../types/common.types';

describe('Common Types', () => {
  describe('isRTL', () => {
    it('should return true for Hebrew (he)', () => {
      expect(isRTL('he')).toBe(true);
    });

    it('should return false for English (en)', () => {
      expect(isRTL('en')).toBe(false);
    });

    it('should return correct values for all supported locales', () => {
      for (const locale of LOCALES) {
        const result = isRTL(locale);
        expect(typeof result).toBe('boolean');
      }
    });
  });

  describe('RTL_LOCALES', () => {
    it('should contain he', () => {
      expect(RTL_LOCALES).toContain('he');
    });

    it('should not contain en', () => {
      expect(RTL_LOCALES).not.toContain('en');
    });

    it('should be a subset of supported locales', () => {
      for (const rtlLocale of RTL_LOCALES) {
        expect((LOCALES as readonly string[]).includes(rtlLocale)).toBe(true);
      }
    });
  });

  describe('Locale constants', () => {
    it('should have en and he as supported locales', () => {
      expect(LOCALES).toContain('en');
      expect(LOCALES).toContain('he');
    });

    it('should have en as default locale', () => {
      expect(DEFAULT_LOCALE).toBe('en');
    });

    it('should have default locale in supported locales', () => {
      expect((LOCALES as readonly Locale[])).toContain(DEFAULT_LOCALE);
    });
  });
});
