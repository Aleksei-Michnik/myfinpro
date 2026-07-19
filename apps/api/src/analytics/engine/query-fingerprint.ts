import { createHash } from 'crypto';
import { tzOffsetMs } from '@myfinpro/shared';

/**
 * Canonical JSON — object keys sorted recursively, so two semantically equal
 * queries fingerprint identically regardless of property order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

/**
 * Fingerprint of the pagination-independent part of an analytics query
 * (design §2.5): an offset cursor is only valid for the exact query that
 * produced it — `limit` and `cursor` themselves are excluded.
 */
export function queryFingerprint(query: Record<string, unknown>): string {
  const { limit: _limit, cursor: _cursor, ...rest } = query;
  const json = JSON.stringify(canonicalize(rest));
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * `±HH:MM` UTC-offset string of an IANA timezone at instant `at` — the form
 * MySQL `CONVERT_TZ` accepts without named-timezone tables. Fixed per query;
 * DST-edge mis-bucketing is the accepted v1 limitation (design §2.5).
 */
export function utcOffsetString(timezone: string, at: Date): string {
  let offsetMs: number;
  try {
    offsetMs = tzOffsetMs(at.getTime(), timezone);
  } catch {
    offsetMs = 0; // Unknown/invalid stored timezone → UTC buckets.
  }
  const totalMinutes = Math.round(offsetMs / 60_000);
  const sign = totalMinutes < 0 ? '-' : '+';
  const abs = Math.abs(totalMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}
