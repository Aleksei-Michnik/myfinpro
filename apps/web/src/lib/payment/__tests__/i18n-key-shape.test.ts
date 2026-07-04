// Phase 6 · Iteration 6.15.2 — defensive checks against i18n-key shape bugs.
//
// Background: a user-reported staging bug rendered the literal string
// `payments.payments.scope.personal` in the Recent Activity scope cell.
// Root cause: `formatScopeLabel` called `t('payments.scope.personal')` from
// a translation function that was already namespaced via
// `useTranslations('payments')` — producing a non-existent resolved path
// `payments.payments.scope.personal` and falling back to the literal key.
//
// These tests are cheap, deterministic guards against the same class of
// mistake elsewhere in the codebase.

import { describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import heMessages from '@/../messages/he.json';

type Messages = Record<string, unknown>;

/** Recursively flatten a nested messages object into dotted keys. */
function flatten(obj: Messages, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatten(v as Messages, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** Look up a dotted path in a messages bundle. Returns undefined if missing. */
function lookup(obj: Messages, dotted: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotted.split('.')) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

describe('i18n key shape (regression for 6.15.2)', () => {
  const enKeys = flatten(enMessages as Messages);
  const heKeys = flatten(heMessages as Messages);

  // The bug pattern is specifically a top-level namespace appearing as both
  // the first AND second segment of a key (e.g. `payments.payments.scope.personal`).
  // Legit nested labels like `groups.create.create` (button under a section
  // of the same name) are not flagged.
  const topLevels = Object.keys(enMessages as Messages);
  const doubledTopLevel = (k: string) => topLevels.some((ns) => k.startsWith(`${ns}.${ns}.`));

  it('en messages contain no key starting with `<ns>.<ns>.`', () => {
    expect(enKeys.filter(doubledTopLevel)).toEqual([]);
  });

  it('he messages contain no key starting with `<ns>.<ns>.`', () => {
    expect(heKeys.filter(doubledTopLevel)).toEqual([]);
  });

  it('formatScopeLabel keys exist in en + he under the payments namespace', () => {
    // The formatter is invoked with a `t` from `useTranslations('payments')`,
    // so the keys it passes must exist as `payments.<key>` in the bundle.
    const required = ['payments.scope.personal', 'payments.scope.group'];
    for (const k of required) {
      expect(lookup(enMessages as Messages, k), `missing en: ${k}`).toBeTypeOf('string');
      expect(lookup(heMessages as Messages, k), `missing he: ${k}`).toBeTypeOf('string');
    }
  });

  it('the bug-trigger path payments.payments.scope.personal is absent in en + he', () => {
    expect(lookup(enMessages as Messages, 'payments.payments.scope.personal')).toBeUndefined();
    expect(lookup(heMessages as Messages, 'payments.payments.scope.personal')).toBeUndefined();
  });
});
