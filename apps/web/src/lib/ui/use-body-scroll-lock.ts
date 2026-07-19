'use client';

// Phase 8.27 follow-up — body scroll lock for modal surfaces (dialogs,
// fullscreen viewers). Counter-based so nested locks (e.g. a ConfirmDialog
// above an open quick view) release correctly regardless of unmount order.

import { useEffect } from 'react';

let lockCount = 0;

/** Locks `document.body` scrolling while `active`; releases on unmount. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = '';
    };
  }, [active]);
}
