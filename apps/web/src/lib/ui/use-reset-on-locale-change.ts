'use client';

// Phase 6 · Iteration 6.16.5 — DRY hook used by every page-level orchestrator
// to clear page-scoped errors when the locale changes (en ↔ he via the
// next-intl locale switcher). Without this, errors accumulated in a previous
// render briefly leak into the new locale's render before the fresh fetch
// resolves, producing the "no access" flicker reported on staging.
//
// Usage:
//   useResetOnLocaleChange(() => {
//     op.reset();
//     void op.run((signal) => fetchSomething(signal));
//   });
//
// The callback runs once per locale-segment change (NOT on the initial
// mount). Callers that need an initial run should keep their existing
// mount-only effect.

import { useLocale } from 'next-intl';
import { useEffect, useRef } from 'react';

export function useResetOnLocaleChange(onChange: () => void): void {
  const locale = useLocale();
  const previousLocaleRef = useRef<string>(locale);
  // Stable ref so consumers can pass an inline arrow without retriggering.
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  useEffect(() => {
    if (previousLocaleRef.current === locale) return;
    previousLocaleRef.current = locale;
    callbackRef.current();
  }, [locale]);
}
