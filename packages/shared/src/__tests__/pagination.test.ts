import { describe, it, expect } from 'vitest';

import { encodeCursor, decodeCursor, PAGINATION_DEFAULTS } from '../dto/pagination.dto';

describe('Pagination', () => {
  describe('PAGINATION_DEFAULTS', () => {
    it('should have a default limit of 20', () => {
      expect(PAGINATION_DEFAULTS.DEFAULT_LIMIT).toBe(20);
    });

    it('should have a max limit of 100', () => {
      expect(PAGINATION_DEFAULTS.MAX_LIMIT).toBe(100);
    });

    it('should have a default sort order of desc', () => {
      expect(PAGINATION_DEFAULTS.DEFAULT_SORT_ORDER).toBe('desc');
    });
  });

  describe('encodeCursor / decodeCursor', () => {
    it('should encode and decode a simple object', () => {
      const data = { id: '123', createdAt: '2024-01-01T00:00:00Z' };
      const cursor = encodeCursor(data);
      expect(typeof cursor).toBe('string');
      expect(cursor.length).toBeGreaterThan(0);

      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(data);
    });

    it('should produce a base64url-encoded string', () => {
      const data = { id: 'test' };
      const cursor = encodeCursor(data);
      // base64url does not contain +, /, or = padding in standard form
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should handle numeric values', () => {
      const data = { offset: 42, timestamp: 1700000000 };
      const cursor = encodeCursor(data);
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(data);
    });

    it('should handle boolean values', () => {
      const data = { active: true, deleted: false };
      const cursor = encodeCursor(data);
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(data);
    });

    it('should handle nested objects', () => {
      const data = { sort: { field: 'createdAt', order: 'desc' } };
      const cursor = encodeCursor(data);
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(data);
    });

    it('should throw on invalid cursor string', () => {
      expect(() => decodeCursor('not-valid-base64!')).toThrow('Invalid cursor format');
    });

    it('should throw on cursor that decodes to a non-object', () => {
      // Encode a JSON string (not an object)
      const cursor = Buffer.from('"just a string"', 'utf-8').toString('base64url');
      expect(() => decodeCursor(cursor)).toThrow('Cursor must decode to a plain object');
    });

    it('should throw on cursor that decodes to an array', () => {
      const cursor = Buffer.from('[1,2,3]', 'utf-8').toString('base64url');
      expect(() => decodeCursor(cursor)).toThrow('Cursor must decode to a plain object');
    });

    it('should throw on cursor that decodes to null', () => {
      const cursor = Buffer.from('null', 'utf-8').toString('base64url');
      expect(() => decodeCursor(cursor)).toThrow('Cursor must decode to a plain object');
    });

    it('should roundtrip an empty object', () => {
      const data = {};
      const cursor = encodeCursor(data);
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(data);
    });
  });
});
