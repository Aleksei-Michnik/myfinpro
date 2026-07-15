// Phase 6 · Iteration 6.11 — SSR-safe localStorage wrapper for last-used
// selections on the payment entry form (scope, direction, type). Every
// accessor guards against `window === undefined`, JSON parse errors, and
// localStorage quota errors, and falls back to spec-defined defaults.

import { PAYMENT_TYPES } from '@myfinpro/shared';
import type { AttributionScope, PaymentDirection, PaymentType } from './types';

const KEY_SCOPES = 'myfin.payment.lastScopes';
const KEY_DIRECTION = 'myfin.payment.lastDirection';
const KEY_TYPE = 'myfin.payment.lastType';

const DEFAULT_SCOPES: AttributionScope[] = [{ scope: 'personal' }];
const DEFAULT_DIRECTION: PaymentDirection = 'OUT';
const DEFAULT_TYPE: PaymentType = 'ONE_TIME';

/** Return the browser's localStorage, or null when not available (SSR, privacy mode). */
function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidScope(x: unknown): x is AttributionScope {
  if (!x || typeof x !== 'object') return false;
  const v = x as { scope?: unknown; groupId?: unknown };
  if (v.scope === 'personal') return true;
  return v.scope === 'group' && typeof v.groupId === 'string' && v.groupId.length > 0;
}

export function getLastUsedScopes(): AttributionScope[] {
  const s = safeStorage();
  if (!s) return [...DEFAULT_SCOPES];
  try {
    const raw = s.getItem(KEY_SCOPES);
    if (!raw) return [...DEFAULT_SCOPES];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_SCOPES];
    const valid = parsed.filter(isValidScope);
    return valid.length > 0 ? valid : [...DEFAULT_SCOPES];
  } catch {
    return [...DEFAULT_SCOPES];
  }
}

export function setLastUsedScopes(scopes: AttributionScope[]): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(KEY_SCOPES, JSON.stringify(scopes));
  } catch {
    /* quota / private-mode — silently swallow per spec §6.4 */
  }
}

export function getLastUsedDirection(): PaymentDirection {
  const s = safeStorage();
  if (!s) return DEFAULT_DIRECTION;
  try {
    const raw = s.getItem(KEY_DIRECTION);
    return raw === 'IN' || raw === 'OUT' ? raw : DEFAULT_DIRECTION;
  } catch {
    return DEFAULT_DIRECTION;
  }
}

export function setLastUsedDirection(direction: PaymentDirection): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(KEY_DIRECTION, direction);
  } catch {
    /* */
  }
}

export function getLastUsedType(): PaymentType {
  const s = safeStorage();
  if (!s) return DEFAULT_TYPE;
  try {
    const raw = s.getItem(KEY_TYPE);
    if (raw && (PAYMENT_TYPES as readonly string[]).includes(raw)) {
      return raw as PaymentType;
    }
    return DEFAULT_TYPE;
  } catch {
    return DEFAULT_TYPE;
  }
}

export function setLastUsedType(type: PaymentType): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(KEY_TYPE, type);
  } catch {
    /* */
  }
}
