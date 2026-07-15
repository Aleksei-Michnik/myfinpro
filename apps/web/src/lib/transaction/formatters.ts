// Phase 6 · Iteration 6.11 — pure, locale-aware formatting helpers.
// Side-effect free: accept a locale string (+ optionally `t` for the scope
// label) and return a formatted string. Built on `Intl.NumberFormat` /
// `Intl.DateTimeFormat` — no extra dependencies (dinero.js / date-fns).

import type { TransactionSummary } from './types';

/**
 * Format an integer minor-unit amount as a localised currency string.
 *
 *   formatAmount(1250, 'USD', 'en-US') → '$12.50'
 *   formatAmount(1250, 'EUR', 'de-DE') → '12,50 €'
 *   formatAmount(1250, 'ILS', 'he-IL') → '‏12.50 ₪' (platform-dependent)
 */
export function formatAmount(amountCents: number, currency: string, locale: string): string {
  const value = amountCents / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a transaction amount with an explicit `+` / `-` sign derived from the
 * transaction's direction (not from the numeric sign). The underlying
 * `Intl.NumberFormat` output is stripped of any leading +/- and re-prefixed
 * so the rendered glyph is always consistent.
 */
export function formatSignedAmount(
  transaction: Pick<TransactionSummary, 'amountCents' | 'currency' | 'direction'>,
  locale: string,
): string {
  const sign = transaction.direction === 'OUT' ? '-' : '+';
  const formatted = formatAmount(Math.abs(transaction.amountCents), transaction.currency, locale);
  return sign + formatted.replace(/^[-+]/, '');
}

/**
 * Format a transaction's `occurredAt` ISO string as a localised date+time.
 * Returns an empty string on an unparseable input so callers never crash.
 *
 * Phase 6 · Iteration 6.18.1.2 — the helper now defaults to including the
 * time of day (`dateStyle: 'medium', timeStyle: 'short'`) since the
 * transaction form (6.18.1) accepts a full ISO timestamp:
 *
 *   formatOccurredAt('2026-05-19T14:30:00Z', 'en-US') → 'May 19, 2026, 2:30 PM'
 *   formatOccurredAt('2026-05-19T14:30:00Z', 'he-IL') → '19 במאי 2026, 14:30'
 *
 * Existing rows stored with a midnight timestamp continue to render the
 * time component (`12:00 AM` / `00:00`) — we deliberately do NOT suppress
 * it so the format stays consistent across the app.
 */
export function formatOccurredAt(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/**
 * Date-only variant — surfaces that genuinely don't want the time component
 * (e.g. schedule `Starts on` / `Ends on` columns that don't carry a
 * meaningful time). Mirrors the pre-6.18.1.2 default of `formatOccurredAt`.
 */
export function formatOccurredDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

/**
 * Absolute, fully-qualified date+time — used for `title=` tooltips on
 * relative-time chips (e.g. the schedule badge's "in 5 minutes" hover).
 *
 *   formatOccurredAtAbsolute('2026-05-19T14:30:00Z', 'en-US')
 *     → 'May 19, 2026 at 2:30:00 PM UTC'
 */
export function formatOccurredAtAbsolute(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(d);
}

/**
 * Resolve a human-readable scope label for a single attribution row.
 * `t` is the next-intl `useTranslations('transactions')` function (passed in so
 * this helper stays pure and testable). Keys are *relative* to the
 * `transactions` namespace — matching the project convention for any helper
 * receiving a `t` function from a `transactions.*` component.
 *
 *   personal                                    → t('scope.personal')
 *   group with name                             → the group name verbatim
 *   group with null name (defensive fallback)   → t('scope.group')
 */
export function formatScopeLabel(
  attribution: Pick<TransactionSummary['attributions'][number], 'scope' | 'groupName'>,
  t: (key: string) => string,
): string {
  if (attribution.scope === 'personal') return t('scope.personal');
  return attribution.groupName ?? t('scope.group');
}
