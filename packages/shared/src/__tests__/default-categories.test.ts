import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_IN_CATEGORIES,
  DEFAULT_OUT_CATEGORIES,
} from '../constants/default-categories';

describe('default categories', () => {
  it('combined list equals OUT + IN', () => {
    expect(DEFAULT_CATEGORIES).toEqual([...DEFAULT_OUT_CATEGORIES, ...DEFAULT_IN_CATEGORIES]);
  });

  it('OUT categories all have direction=OUT', () => {
    for (const c of DEFAULT_OUT_CATEGORIES) expect(c.direction).toBe('OUT');
  });

  it('IN categories all have direction=IN', () => {
    for (const c of DEFAULT_IN_CATEGORIES) expect(c.direction).toBe('IN');
  });

  it('slugs are unique within (slug, direction)', () => {
    const pairs = new Set(DEFAULT_CATEGORIES.map((c) => `${c.slug}:${c.direction}`));
    expect(pairs.size).toBe(DEFAULT_CATEGORIES.length);
  });

  it('slugs are kebab_snake (letters, digits, underscore, hyphen)', () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.slug).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it('has expected minimum coverage: ≥ 15 OUT and ≥ 6 IN', () => {
    expect(DEFAULT_OUT_CATEGORIES.length).toBeGreaterThanOrEqual(15);
    expect(DEFAULT_IN_CATEGORIES.length).toBeGreaterThanOrEqual(6);
  });
});
