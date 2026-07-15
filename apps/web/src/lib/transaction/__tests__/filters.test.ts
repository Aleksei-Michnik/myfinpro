// Phase 6 · Iteration 6.16.1 — unit tests for the URL ↔ filter helpers.

import { describe, expect, it } from 'vitest';
import {
  clearFilters,
  defaultFilters,
  filtersFromQuery,
  filtersToQuery,
  isFiltersDirty,
  type TransactionFilters,
} from '../filters';

describe('lib/transaction/filters', () => {
  // ── defaultFilters ───────────────────────────────────────────────────────

  it('defaultFilters() returns scope=all + sort=date_desc', () => {
    expect(defaultFilters()).toEqual({ scope: 'all', sort: 'date_desc' });
  });

  it('defaultFilters("personal") preserves the personal scope', () => {
    expect(defaultFilters('personal')).toEqual({ scope: 'personal', sort: 'date_desc' });
  });

  it('defaultFilters("group:abc") preserves the group scope', () => {
    expect(defaultFilters('group:abc')).toEqual({ scope: 'group:abc', sort: 'date_desc' });
  });

  // ── filtersToQuery ───────────────────────────────────────────────────────

  it('filtersToQuery emits no params for the default state', () => {
    expect(filtersToQuery(defaultFilters()).toString()).toBe('');
  });

  it('filtersToQuery serialises every supported field', () => {
    const f: TransactionFilters = {
      scope: 'group:g-1',
      starred: true,
      direction: 'OUT',
      categoryId: 'c-1',
      from: '2026-01-01',
      to: '2026-12-31',
      search: 'coffee',
      sort: 'amount_desc',
    };
    const qs = filtersToQuery(f).toString();
    // URLSearchParams encodes ":" as "%3A".
    expect(qs).toContain('scope=group%3Ag-1');
    expect(qs).toContain('starred=1');
    expect(qs).toContain('direction=OUT');
    expect(qs).toContain('categoryId=c-1');
    expect(qs).toContain('from=2026-01-01');
    expect(qs).toContain('to=2026-12-31');
    expect(qs).toContain('q=coffee');
    expect(qs).toContain('sort=amount_desc');
  });

  it('filtersToQuery omits starred=1 when starred is false/undefined', () => {
    expect(filtersToQuery({ scope: 'all', sort: 'date_desc', starred: false }).toString()).toBe('');
    expect(filtersToQuery({ scope: 'all', sort: 'date_desc' }).toString()).toBe('');
  });

  it('filtersToQuery omits sort when it is the default date_desc', () => {
    const qs = filtersToQuery({ scope: 'all', sort: 'date_desc', direction: 'IN' }).toString();
    expect(qs).toBe('direction=IN');
  });

  // ── filtersFromQuery ─────────────────────────────────────────────────────

  it('filtersFromQuery returns defaults for an empty params bag', () => {
    expect(filtersFromQuery(new URLSearchParams())).toEqual({
      scope: 'all',
      starred: undefined,
      direction: undefined,
      categoryId: undefined,
      from: undefined,
      to: undefined,
      search: undefined,
      sort: 'date_desc',
      childScope: undefined,
    });
  });

  it('filtersFromQuery parses every supported key', () => {
    const params = new URLSearchParams(
      'scope=group:g-1&starred=1&direction=IN&categoryId=c-9&from=2026-04-01&to=2026-04-30&q=tea&sort=amount_asc',
    );
    expect(filtersFromQuery(params)).toEqual({
      scope: 'group:g-1',
      starred: true,
      direction: 'IN',
      categoryId: 'c-9',
      from: '2026-04-01',
      to: '2026-04-30',
      search: 'tea',
      sort: 'amount_asc',
      childScope: undefined,
    });
  });

  it('filtersFromQuery drops invalid `direction` values', () => {
    const params = new URLSearchParams('direction=SIDEWAYS');
    expect(filtersFromQuery(params).direction).toBeUndefined();
  });

  it('filtersFromQuery falls back to date_desc for an invalid `sort`', () => {
    const params = new URLSearchParams('sort=bogus');
    expect(filtersFromQuery(params).sort).toBe('date_desc');
  });

  it('filtersFromQuery treats anything other than "1" as starred=undefined', () => {
    expect(filtersFromQuery(new URLSearchParams('starred=true')).starred).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('starred=0')).starred).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('starred=1')).starred).toBe(true);
  });

  it('filtersFromQuery rejects unknown scopes (falls back to "all")', () => {
    expect(filtersFromQuery(new URLSearchParams('scope=garbage')).scope).toBe('all');
    expect(filtersFromQuery(new URLSearchParams('scope=group:abc')).scope).toBe('group:abc');
    expect(filtersFromQuery(new URLSearchParams('scope=personal')).scope).toBe('personal');
  });

  // ── round-trip ───────────────────────────────────────────────────────────

  it('filtersFromQuery(filtersToQuery(x)) ≈ x for a representative input', () => {
    const x: TransactionFilters = {
      scope: 'group:g-1',
      starred: true,
      direction: 'OUT',
      categoryId: 'c-1',
      from: '2026-01-01',
      to: '2026-12-31',
      search: 'coffee',
      sort: 'amount_desc',
    };
    const round = filtersFromQuery(filtersToQuery(x));
    expect(round).toEqual({
      scope: 'group:g-1',
      starred: true,
      direction: 'OUT',
      categoryId: 'c-1',
      from: '2026-01-01',
      to: '2026-12-31',
      search: 'coffee',
      sort: 'amount_desc',
      childScope: undefined,
    });
  });

  it('round-trip is idempotent for the empty/default state', () => {
    const def = defaultFilters();
    const round = filtersFromQuery(filtersToQuery(def));
    // After a round-trip, omitted optionals come back as undefined.
    expect(round).toEqual({
      scope: 'all',
      starred: undefined,
      direction: undefined,
      categoryId: undefined,
      from: undefined,
      to: undefined,
      search: undefined,
      sort: 'date_desc',
      childScope: undefined,
    });
  });

  // ── isFiltersDirty ───────────────────────────────────────────────────────

  it('isFiltersDirty returns false for defaultFilters() at every scope', () => {
    expect(isFiltersDirty(defaultFilters())).toBe(false);
    expect(isFiltersDirty(defaultFilters('personal'))).toBe(false);
    expect(isFiltersDirty(defaultFilters('group:g-1'))).toBe(false);
  });

  it('isFiltersDirty flips to true when any non-default field is set', () => {
    expect(isFiltersDirty({ ...defaultFilters(), starred: true })).toBe(true);
    expect(isFiltersDirty({ ...defaultFilters(), direction: 'IN' })).toBe(true);
    expect(isFiltersDirty({ ...defaultFilters(), categoryId: 'c-1' })).toBe(true);
    expect(isFiltersDirty({ ...defaultFilters(), from: '2026-01-01' })).toBe(true);
    expect(isFiltersDirty({ ...defaultFilters(), to: '2026-01-31' })).toBe(true);
    expect(isFiltersDirty({ ...defaultFilters(), search: 'q' })).toBe(true);
    expect(isFiltersDirty({ ...defaultFilters(), sort: 'amount_desc' })).toBe(true);
  });

  it('isFiltersDirty ignores empty search strings', () => {
    expect(isFiltersDirty({ ...defaultFilters(), search: '' })).toBe(false);
  });

  // ── clearFilters ────────────────────────────────────────────────────────

  it('clearFilters preserves the active scope and resets everything else', () => {
    expect(clearFilters('personal')).toEqual({ scope: 'personal', sort: 'date_desc' });
    expect(clearFilters('group:g-9')).toEqual({ scope: 'group:g-9', sort: 'date_desc' });
    expect(clearFilters()).toEqual({ scope: 'all', sort: 'date_desc' });
  });

  // ── childScope (iteration 6.18.1.3) ─────────────────────────────────────

  describe('childScope round-trip', () => {
    it('serialises childScope=parents through the URL', () => {
      const f: TransactionFilters = { ...defaultFilters(), childScope: 'parents' };
      expect(filtersToQuery(f).toString()).toBe('childScope=parents');
    });

    it('serialises childScope=occurrences through the URL', () => {
      const f: TransactionFilters = { ...defaultFilters(), childScope: 'occurrences' };
      expect(filtersToQuery(f).toString()).toBe('childScope=occurrences');
    });

    it('omits childScope=all (default) from the URL', () => {
      expect(filtersToQuery({ ...defaultFilters(), childScope: 'all' }).toString()).toBe('');
    });

    it('parses childScope from the URL', () => {
      expect(filtersFromQuery(new URLSearchParams('childScope=parents')).childScope).toBe(
        'parents',
      );
      expect(filtersFromQuery(new URLSearchParams('childScope=occurrences')).childScope).toBe(
        'occurrences',
      );
    });

    it('drops invalid childScope values', () => {
      expect(
        filtersFromQuery(new URLSearchParams('childScope=garbage')).childScope,
      ).toBeUndefined();
    });

    it('round-trips a representative filter object that includes childScope', () => {
      const f: TransactionFilters = { ...defaultFilters(), childScope: 'occurrences' };
      const round = filtersFromQuery(filtersToQuery(f));
      expect(round.childScope).toBe('occurrences');
    });

    it('isFiltersDirty flips to true when childScope is non-default', () => {
      expect(isFiltersDirty({ ...defaultFilters(), childScope: 'parents' })).toBe(true);
      expect(isFiltersDirty({ ...defaultFilters(), childScope: 'occurrences' })).toBe(true);
      expect(isFiltersDirty({ ...defaultFilters(), childScope: 'all' })).toBe(false);
    });
  });
});
