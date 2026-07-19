import { queryFingerprint, utcOffsetString } from './query-fingerprint';

describe('queryFingerprint', () => {
  const base = {
    dimensions: ['category', 'period'],
    granularity: 'month',
    filters: { direction: 'OUT', categoryIds: ['c1', 'c2'] },
  };

  it('is stable across property order', () => {
    const reordered = {
      filters: { categoryIds: ['c1', 'c2'], direction: 'OUT' },
      granularity: 'month',
      dimensions: ['category', 'period'],
    };
    expect(queryFingerprint(reordered)).toBe(queryFingerprint(base));
  });

  it('ignores limit and cursor', () => {
    expect(queryFingerprint({ ...base, limit: 50, cursor: 'abc' })).toBe(queryFingerprint(base));
  });

  it('ignores undefined values', () => {
    expect(queryFingerprint({ ...base, sort: undefined })).toBe(queryFingerprint(base));
  });

  it('changes when the query changes', () => {
    expect(queryFingerprint({ ...base, dimensions: ['merchant'] })).not.toBe(
      queryFingerprint(base),
    );
    expect(queryFingerprint({ ...base, filters: { ...base.filters, direction: 'IN' } })).not.toBe(
      queryFingerprint(base),
    );
    // Array order is semantic (dimension order controls key order).
    expect(queryFingerprint({ ...base, dimensions: ['period', 'category'] })).not.toBe(
      queryFingerprint(base),
    );
  });
});

describe('utcOffsetString', () => {
  const summer = new Date('2026-07-17T12:00:00Z');
  const winter = new Date('2026-01-15T12:00:00Z');

  it('formats UTC as +00:00', () => {
    expect(utcOffsetString('UTC', summer)).toBe('+00:00');
  });

  it('tracks DST for Asia/Jerusalem', () => {
    expect(utcOffsetString('Asia/Jerusalem', summer)).toBe('+03:00');
    expect(utcOffsetString('Asia/Jerusalem', winter)).toBe('+02:00');
  });

  it('formats negative offsets', () => {
    expect(utcOffsetString('America/New_York', summer)).toBe('-04:00');
    expect(utcOffsetString('America/New_York', winter)).toBe('-05:00');
  });

  it('formats half-hour offsets', () => {
    expect(utcOffsetString('Asia/Kolkata', summer)).toBe('+05:30');
  });

  it('falls back to +00:00 for an invalid timezone', () => {
    expect(utcOffsetString('Not/AZone', summer)).toBe('+00:00');
  });
});
