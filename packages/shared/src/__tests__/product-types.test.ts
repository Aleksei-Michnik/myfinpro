import { describe, expect, it } from 'vitest';
import { isValidGtin, normalizeGtin, normalizeLookupName } from '../types/product.types';

describe('normalizeLookupName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeLookupName('  Shufersal   DEAL  ')).toBe('shufersal deal');
  });

  it('strips diacritics but keeps base letters', () => {
    expect(normalizeLookupName('Café Über')).toBe('cafe uber');
  });

  it('keeps Hebrew intact', () => {
    expect(normalizeLookupName('שופרסל דיל')).toBe('שופרסל דיל');
  });

  it('caps at the default merchant length', () => {
    expect(normalizeLookupName('x'.repeat(300))).toHaveLength(200);
  });

  it('honours a custom max length for product names', () => {
    expect(normalizeLookupName('x'.repeat(400), 300)).toHaveLength(300);
  });
});

describe('normalizeGtin / isValidGtin', () => {
  it('strips whitespace and hyphens', () => {
    expect(normalizeGtin(' 729-0000-066318 ')).toBe('7290000066318');
  });

  it('accepts valid GTIN-13 (EAN-13)', () => {
    expect(isValidGtin('7290000066318')).toBe(true);
    expect(isValidGtin('4006381333931')).toBe(true);
  });

  it('accepts valid GTIN-8 and GTIN-12 (UPC-A)', () => {
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
  });

  it('accepts valid GTIN-14', () => {
    expect(isValidGtin('10036000291459')).toBe(true);
  });

  it('rejects bad check digits', () => {
    expect(isValidGtin('7290000066317')).toBe(false);
    expect(isValidGtin('4006381333932')).toBe(false);
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('123456789')).toBe(false); // 9 digits — not a GTIN size
    expect(isValidGtin('abcdefgh')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });
});
