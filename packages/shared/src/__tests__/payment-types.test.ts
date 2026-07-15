import { describe, it, expect } from 'vitest';
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  TRANSACTION_FREQUENCIES,
  CATEGORY_OWNER_TYPES,
  CATEGORY_DIRECTIONS,
  ATTRIBUTION_SCOPE_TYPES,
  TRANSACTION_SORTS,
  AMORTIZATION_METHODS,
  TRANSACTION_PLAN_KINDS,
  type AttributionScope,
} from '../types/transaction.types';

describe('transaction.types string-literal arrays', () => {
  const arrays = {
    TRANSACTION_DIRECTIONS,
    TRANSACTION_TYPES,
    TRANSACTION_STATUSES,
    TRANSACTION_FREQUENCIES,
    CATEGORY_OWNER_TYPES,
    CATEGORY_DIRECTIONS,
    ATTRIBUTION_SCOPE_TYPES,
    TRANSACTION_SORTS,
    AMORTIZATION_METHODS,
    TRANSACTION_PLAN_KINDS,
  };

  it.each(Object.entries(arrays))('%s is a non-empty readonly tuple of strings', (_name, arr) => {
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    for (const v of arr) expect(typeof v).toBe('string');
    // Roundtrip: cheap guarantee the values stay serialisable.
    expect(JSON.parse(JSON.stringify(arr))).toEqual([...arr]);
  });

  it('TRANSACTION_DIRECTIONS contains exactly IN and OUT', () => {
    expect([...TRANSACTION_DIRECTIONS].sort()).toEqual(['IN', 'OUT']);
  });

  it('TRANSACTION_PLAN_KINDS is a subset of TRANSACTION_TYPES', () => {
    for (const k of TRANSACTION_PLAN_KINDS) {
      expect(TRANSACTION_TYPES).toContain(k);
    }
  });

  it('AttributionScope discriminated union compiles with both variants', () => {
    const a: AttributionScope = { scope: 'personal' };
    const b: AttributionScope = { scope: 'group', groupId: 'abc' };
    expect(a.scope).toBe('personal');
    expect(b.scope).toBe('group');
  });
});
