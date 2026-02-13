/**
 * Pagination DTOs for cursor-based pagination.
 *
 * All list endpoints use opaque base64-encoded cursors.
 * Default page size: 20, max: 100.
 */

/** Input query parameters for paginated requests */
export interface PaginationQueryDto {
  /** Opaque base64-encoded cursor from a previous response */
  cursor?: string;
  /** Page size (default 20, max 100) */
  limit?: number;
  /** Field to sort by */
  sortBy?: string;
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/** Output envelope for paginated responses */
export interface PaginatedResponseDto<T> {
  /** Array of items for the current page */
  data: T[];
  /** Opaque cursor for the next page, null when no more pages */
  cursor: string | null;
  /** Whether more pages are available */
  hasMore: boolean;
  /** Optional total count of items (may be omitted for performance) */
  total?: number;
}

/** Pagination default values */
export const PAGINATION_DEFAULTS = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  DEFAULT_SORT_ORDER: 'desc' as const,
} as const;

/**
 * Encode an object into an opaque base64 cursor string.
 * The cursor content is intentionally opaque to clients.
 */
export function encodeCursor(data: Record<string, unknown>): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, 'utf-8').toString('base64url');
}

/**
 * Decode an opaque base64 cursor string back into its object form.
 * Throws if the cursor is malformed.
 */
export function decodeCursor(cursor: string): Record<string, unknown> {
  let json: string;
  let parsed: unknown;

  try {
    json = Buffer.from(cursor, 'base64url').toString('utf-8');
  } catch {
    throw new Error('Invalid cursor format');
  }

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid cursor format');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Cursor must decode to a plain object');
  }

  return parsed as Record<string, unknown>;
}
