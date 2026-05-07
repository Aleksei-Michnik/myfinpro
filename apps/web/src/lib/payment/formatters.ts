// Phase 6 · Iteration 6.11 — pure, locale-aware formatting helpers.
// Side-effect free: accept a locale string (+ optionally `t` for the scope
// label) and return a formatted string. Built on `Intl.NumberFormat` /
// `Intl.DateTimeFormat` — no extra dependencies (dinero.js / date-fns).

import type { PaymentSummary } from './types';

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
 * Format a payment amount with an explicit `+` / `-` sign derived from the
 * payment's direction (not from the numeric sign). The underlying
 * `Intl.NumberFormat` output is stripped of any leading +/- and re-prefixed
 * so the rendered glyph is always consistent.
 */
export function formatSignedAmount(
  payment: Pick<PaymentSummary, 'amountCents' | 'currency' | 'direction'>,
  locale: string,
): string {
  const sign = payment.direction === 'OUT' ? '-' : '+';
  const formatted = formatAmount(Math.abs(payment.amountCents), payment.currency, locale);
  return sign + formatted.replace(/^[-+]/, '');
}

/**
 * Format a payment's `occurredAt` ISO string as a short localised date.
 * Returns an empty string on an unparseable input so callers never crash.
 *
 *   formatOccurredAt('2026-04-25T00:00:00Z', 'en-US') → 'Apr 25, 2026'
 */
export function formatOccurredAt(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

/**
 * Resolve a human-readable scope label for a single attribution row.
 * `t` is the next-intl `useTranslations()` function (passed in so this
 * helper stays pure and testable).
 *
 *   personal                                    → t('payments.scope.personal')
 *   group with name                             → the group name verbatim
 *   group with null name (defensive fallback)   → t('payments.scope.group')
 */
export function formatScopeLabel(
  attribution: Pick<PaymentSummary['attributions'][number], 'scope' | 'groupName'>,
  t: (key: string) => string,
): string {
  if (attribution.scope === 'personal') return t('payments.scope.personal');
  return attribution.groupName ?? t('payments.scope.group');
}
