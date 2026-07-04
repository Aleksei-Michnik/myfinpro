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

  it('display names are unique within a direction (case-insensitive)', () => {
    for (const list of [DEFAULT_OUT_CATEGORIES, DEFAULT_IN_CATEGORIES]) {
      const seen = new Set<string>();
      for (const c of list) {
        const key = c.name.toLowerCase();
        expect(seen.has(key), `duplicate name "${c.name}" in ${c.direction}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('no two categories share the same stem across directions (avoids Gift/Gifts confusion)', () => {
    // Intentional cross-direction duplicates (visually disambiguated via the
    // direction context — IN "Other" is for unclassified income, OUT "Other"
    // for unclassified expense). Add to this allowlist sparingly; new entries
    // should follow the `gift_in`/"Gifts received" pattern instead.
    const ALLOWED_CROSS_DIRECTION_STEMS = new Set(['other']);

    const stem = (s: string) => s.toLowerCase().replace(/s$/, '');
    const out = new Set(DEFAULT_OUT_CATEGORIES.map((c) => stem(c.name)));
    for (const c of DEFAULT_IN_CATEGORIES) {
      const s = stem(c.name);
      if (ALLOWED_CROSS_DIRECTION_STEMS.has(s)) continue;
      expect(out.has(s), `IN category "${c.name}" collides with an OUT name on stem "${s}"`).toBe(
        false,
      );
    }
  });
});
