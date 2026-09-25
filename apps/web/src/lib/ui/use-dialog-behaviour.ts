'use client';

// Phase 20 · Iteration 20.1 — THE modal behaviour: body scroll lock, ESC to
// close, Tab focus trap, initial focus and focus restore. Extracted once so
// the 22 hand-rolled dialog shells cannot drift; `<Dialog>` uses it, and the
// full-screen special cases (`DocumentViewer`, `BarcodeScannerDialog`) that
// keep their own layout use it too instead of copying the effects.

import { useEffect, useRef, type RefObject } from 'react';
import { useBodyScrollLock } from './use-body-scroll-lock';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface UseDialogBehaviourOptions {
  /** Mounted-but-closed dialogs pass `false`; conditionally rendered ones pass `true`. */
  open: boolean;
  /** Called on ESC. Backdrop clicks are the caller's (they own the backdrop element). */
  onClose(): void;
  /** Focused on open; defaults to the dialog element itself (`tabIndex={-1}`). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Keep Tab inside the dialog (default `true`). */
  trapFocus?: boolean;
  /** Restore focus to the trigger when the dialog closes (default `true`). */
  restoreFocus?: boolean;
  /** Lock body scrolling while open (default `true`). */
  lockScroll?: boolean;
}

export interface UseDialogBehaviourResult<T extends HTMLElement> {
  /** Attach to the element carrying `role="dialog"`. */
  dialogRef: RefObject<T | null>;
}

export function useDialogBehaviour<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  initialFocusRef,
  trapFocus = true,
  restoreFocus = true,
  lockScroll = true,
}: UseDialogBehaviourOptions): UseDialogBehaviourResult<T> {
  const dialogRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useBodyScrollLock(open && lockScroll);

  // Initial focus + focus restore. The dialog element is focused only when
  // focus is not already inside it, so an `autoFocus` field keeps the caret.
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const target = initialFocusRef?.current;
      if (target) {
        target.focus();
        return;
      }
      const root = dialogRef.current;
      if (root && !root.contains(document.activeElement)) root.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
    // `initialFocusRef` is a ref object, stable by contract — not a dependency.
  }, [open, restoreFocus, initialFocusRef]);

  // ESC + Tab trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !trapFocus) return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, trapFocus]);

  return { dialogRef };
}
