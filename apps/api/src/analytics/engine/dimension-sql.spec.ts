import { ANALYTICS_DIMENSIONS, ANALYTICS_GRANULARITIES } from '@myfinpro/shared';
import { dimensionSelects, needsAttributionJoin } from './dimension-sql';

describe('dimension-sql', () => {
  it('yields exactly one select per dimension except scope (two)', () => {
    for (const dimension of ANALYTICS_DIMENSIONS) {
      const selects = dimensionSelects(dimension, { granularity: 'month' });
      expect(selects.length).toBe(dimension === 'scope' ? 2 : 1);
      for (const s of selects) {
        expect(s.alias).toMatch(/^k_[a-z_]+$/);
        expect(s.expr.sql.length).toBeGreaterThan(0);
      }
    }
  });

  it('produces a period expression for every granularity', () => {
    for (const granularity of ANALYTICS_GRANULARITIES) {
      const [select] = dimensionSelects('period', { granularity, utcOffset: '+03:00' });
      expect(select.alias).toBe('k_period');
      expect(select.expr.sql).toContain('CONVERT_TZ');
      // The offset rides as a bound parameter, never as SQL text.
      expect(select.expr.values).toContain('+03:00');
      expect(select.expr.sql).not.toContain('+03:00');
    }
  });

  it('requires the attribution join only for scope/group', () => {
    expect(needsAttributionJoin(['scope'])).toBe(true);
    expect(needsAttributionJoin(['group', 'category'])).toBe(true);
    expect(needsAttributionJoin(['category', 'period'])).toBe(false);
    expect(needsAttributionJoin([])).toBe(false);
  });
});
