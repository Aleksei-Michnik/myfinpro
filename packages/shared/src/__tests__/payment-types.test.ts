import { describe, it, expect } from 'vitest';
import {
  PAYMENT_DIRECTIONS,
  PAYMENT_TYPES,
  PAYMENT_STATUSES,
  PAYMENT_FREQUENCIES,
  CATEGORY_OWNER_TYPES,
  CATEGORY_DIRECTIONS,
  ATTRIBUTION_SCOPE_TYPES,
  PAYMENT_SORTS,
  AMORTIZATION_METHODS,
  PAYMENT_PLAN_KINDS,
  type AttributionScope,
} from '../types/payment.types';

describe('payment.types string-literal arrays', () => {
  const arrays = {
    PAYMENT_DIRECTIONS,
    PAYMENT_TYPES,
    PAYMENT_STATUSES,
    PAYMENT_FREQUENCIES,
    CATEGORY_OWNER_TYPES,
    CATEGORY_DIRECTIONS,
    ATTRIBUTION_SCOPE_TYPES,
    PAYMENT_SORTS,
    AMORTIZATION_METHODS,
    PAYMENT_PLAN_KINDS,
  };

  it.each(Object.entries(arrays))('%s is a non-empty readonly tuple of strings', (_name, arr) => {
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    for (const v of arr) expect(typeof v).toBe('string');
    // Roundtrip: cheap guarantee the values stay serialisable.
    expect(JSON.parse(JSON.stringify(arr))).toEqual([...arr]);
  });

  it('PAYMENT_DIRECTIONS contains exactly IN and OUT', () => {
    expect([...PAYMENT_DIRECTIONS].sort()).toEqual(['IN', 'OUT']);
  });

  it('PAYMENT_PLAN_KINDS is a subset of PAYMENT_TYPES', () => {
    for (const k of PAYMENT_PLAN_KINDS) {
      expect(PAYMENT_TYPES).toContain(k);
    }
  });

  it('AttributionScope discriminated union compiles with both variants', () => {
    const a: AttributionScope = { scope: 'personal' };
    const b: AttributionScope = { scope: 'group', groupId: 'abc' };
    expect(a.scope).toBe('personal');
    expect(b.scope).toBe('group');
  });
});
