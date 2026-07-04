'use client';

// Phase 6 · Iteration 6.16.2 — dimmed overlay for container-scope ops.
// Caller wraps content in a relatively-positioned container; this component
// fills it absolutely. Click-through is blocked. 150ms debounce prevents
// flicker on sub-second operations.

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Spinner } from './Spinner';

export interface LoadingOverlayProps {
  active: boolean;
  /** Message announced by AT and shown under the spinner. */
  message?: string;
  /** Delay before showing to prevent flicker on fast operations. Default 150ms. */
  delayMs?: number;
  className?: string;
  'data-testid'?: string;
}

const DEFAULT_DEBOUNCE_MS = 150;

/** Returns `value` only after it has been true for `delayMs`. False is reflected immediately. */
function useDebouncedTrue(value: boolean, delayMs: number): boolean {
  const [debounced, setDebounced] = useState(false);
  useEffect(() => {
    if (!value) {
      setDebounced(false);
      return;
    }
    const t = setTimeout(() => setDebounced(true), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function LoadingOverlay({
  active,
  message,
  delayMs = DEFAULT_DEBOUNCE_MS,
  className = '',
  'data-testid': dataTestId = 'loading-overlay',
}: LoadingOverlayProps) {
  const t = useTranslations('ui.loading');
  const visible = useDebouncedTrue(active, delayMs);
  const effectiveMessage = message ?? t('overlayDefault');

  if (!visible) return null;

  // Click handler swallows interactions so the user can't reach disabled
  // controls underneath. Keyboard focus is allowed to fall through (controls
  // are disabled anyway and the orchestrator handles `disabled` cascading).
  const swallow = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={dataTestId}
      onClick={swallow}
      onKeyDown={swallow}
      className={`pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gray-900/40 text-gray-100 backdrop-blur-[1px] ${className}`}
    >
      <Spinner size="lg" />
      <span className="text-sm font-medium" data-testid={`${dataTestId}-message`}>
        {effectiveMessage}
      </span>
      {/* Visually-hidden duplicate so AT announces the message reliably. */}
      <span className="sr-only" aria-hidden="false">
        {effectiveMessage}
      </span>
    </div>
  );
}
