// Phase 10 · Iteration 10.3 — SSR-safe localStorage wrapper for the budget
// form's last-used scope. A budget has exactly ONE scope (personal or one
// group), unlike a transaction's multi-scope attribution list, so this
// stores a single `AttributionScope`. Storage guards and scope validation
// are shared with `@/lib/transaction/remember`.

import type { AttributionScope } from '@myfinpro/shared';
import { isValidScope, safeStorage } from '@/lib/transaction/remember';

const KEY_SCOPE = 'myfin.budget.lastScope';

const DEFAULT_SCOPE: AttributionScope = { scope: 'personal' };

export function getLastUsedBudgetScope(): AttributionScope {
  const s = safeStorage();
  if (!s) return { ...DEFAULT_SCOPE };
  try {
    const raw = s.getItem(KEY_SCOPE);
    if (!raw) return { ...DEFAULT_SCOPE };
    const parsed: unknown = JSON.parse(raw);
    return isValidScope(parsed) ? parsed : { ...DEFAULT_SCOPE };
  } catch {
    return { ...DEFAULT_SCOPE };
  }
}

export function setLastUsedBudgetScope(scope: AttributionScope): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(KEY_SCOPE, JSON.stringify(scope));
  } catch {
    /* quota / private-mode — silently swallow, same as transaction remember */
  }
}
