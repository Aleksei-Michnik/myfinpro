'use client';

// Phase 6 · Iteration 6.16.3 — UI status provider with nprogress-style page
// progress bar. Detects navigation START via document-level click
// interception on internal anchors, drives an asymptotic 0 → 90 progress
// while in flight, snaps to 100 when the destination pathname is observed,
// and fades out. Page-scope async operations extend the "in flight" window
// so deep-link initial fetches keep the bar progressing past the route
// change until the data is loaded.
//
// Public API:
//   - <UIStatusProvider> — wraps the app.
//   - useUIStatus() — { activePageOps, registerPageOp } (existing).
//   - useNavProgress() — { visible, progress } for <PageProgressBar>.
//
// State machine:
//   idle → pending (debounce 100 ms) → progressing (RAF 0 → 90)
//                                    → completing (snap to 100, fade 200 ms)
//                                    → idle.
// `wantsBar = navInFlight || activePageOps > 0`. The state machine is
// driven by transitions of `wantsBar`. Click interception sets
// navInFlight=true; pathname-change sets it false. Page-ops increment /
// decrement activePageOps via registerPageOp.

import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ── Tunables (exported for tests) ──────────────────────────────────────────
/** Debounce before the bar becomes visible — fast navs never flash. */
export const NAV_VISIBILITY_DEBOUNCE_MS = 100;
/** Asymptote — progress eases toward this value while in flight. */
export const NAV_PROGRESS_ASYMPTOTE = 90;
/** Per-frame ease factor: nextProgress = current + (asymptote - current) * factor. */
export const NAV_PROGRESS_EASE = 0.05;
/** Fade-out duration after reaching 100 %. */
export const NAV_FADE_OUT_MS = 200;
/** Hard safety stop for stuck navigations (aborted, offline, etc.). */
export const NAV_SAFETY_TIMEOUT_MS = 30_000;

// ── Context types ──────────────────────────────────────────────────────────
export interface UIStatusContextValue {
  /** Active page-scope operations count (existing 6.16.2 API). */
  activePageOps: number;
  /** Register a page-scope op; returns an unregister fn. */
  registerPageOp(id: string): () => void;
  /** Force a navigation start (for callers that bypass <a> clicks). */
  startNavigation(): void;
  /** Force a navigation end (mostly internal — pathname change calls this). */
  endNavigation(): void;
  /** Visibility + progress (0–100) for the singleton <PageProgressBar>. */
  visible: boolean;
  progress: number;
}

const UIStatusContext = createContext<UIStatusContextValue | null>(null);

export interface UIStatusProviderProps {
  children: ReactNode;
  /** Skip the pathname-change auto-end (useful for tests / non-app embeds). */
  disablePathnameTracking?: boolean;
  /** Skip the document-level click interception (tests only). */
  disableClickInterception?: boolean;
  /**
   * Phase 6 · Iteration 6.16.5 — skip the `useLocale()` watcher that drives
   * the page progress bar on locale-only navigations (tests only; opt-in
   * because not every test mounts a `NextIntlClientProvider`).
   */
  disableLocaleTracking?: boolean;
}

type Phase = 'idle' | 'pending' | 'progressing' | 'completing';

/**
 * Decide whether a click on an anchor should trigger startNavigation.
 * Mirrors the rules a regular Next.js router observes — only same-origin,
 * same-tab, plain left-clicks count.
 *
 * Exported for unit testing.
 */
export function shouldInterceptAnchorClick(e: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false; // left button only
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (anchor.target && anchor.target !== '' && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const rawHref = anchor.getAttribute('href');
  if (rawHref == null || rawHref === '') return false;
  if (rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return false;
  // Pure fragment — same page, no navigation.
  if (rawHref.startsWith('#')) return false;
  // Resolve to absolute URL — anchor.href is already resolved by the DOM.
  const win = anchor.ownerDocument?.defaultView;
  if (!win) return false;
  let url: URL;
  try {
    url = new URL(anchor.href, win.location.href);
  } catch {
    return false;
  }
  if (url.origin !== win.location.origin) return false;
  // Same exact destination — no real navigation; only-fragment-different is
  // also not a route change for the App Router pathname listener.
  if (url.pathname === win.location.pathname && url.search === win.location.search) {
    return false;
  }
  return true;
}

export function UIStatusProvider({
  children,
  disablePathnameTracking,
  disableClickInterception,
  disableLocaleTracking,
}: UIStatusProviderProps) {
  // ── Page-scope op count (6.16.2 API) ────────────────────────────────────
  const activeOpsRef = useRef<Set<string>>(new Set());
  const [activePageOps, setActivePageOps] = useState(0);

  // ── Navigation state ────────────────────────────────────────────────────
  const navInFlightRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  // Stable refs for timers / RAF.
  const visibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  // Mirror state in refs so the imperative handlers stay stable.
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const progressRef = useRef(0);
  progressRef.current = progress;
  const activeOpsCountRef = useRef(0);
  activeOpsCountRef.current = activePageOps;

  // ── Helpers ─────────────────────────────────────────────────────────────
  const clearVisibilityTimer = () => {
    if (visibilityTimerRef.current !== null) {
      clearTimeout(visibilityTimerRef.current);
      visibilityTimerRef.current = null;
    }
  };
  const clearFadeTimer = () => {
    if (fadeTimerRef.current !== null) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  };
  const clearSafetyTimer = () => {
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  };
  const cancelRaf = () => {
    if (rafRef.current !== null) {
      const fn =
        typeof globalThis.cancelAnimationFrame === 'function'
          ? globalThis.cancelAnimationFrame
          : (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
      fn(rafRef.current);
      rafRef.current = null;
    }
  };

  const tickProgress = useCallback(() => {
    rafRef.current = null;
    if (phaseRef.current !== 'progressing') return;
    const next = Math.min(
      NAV_PROGRESS_ASYMPTOTE,
      progressRef.current + (NAV_PROGRESS_ASYMPTOTE - progressRef.current) * NAV_PROGRESS_EASE,
    );
    progressRef.current = next;
    setProgress(next);
    if (next < NAV_PROGRESS_ASYMPTOTE - 0.1) {
      const raf =
        typeof globalThis.requestAnimationFrame === 'function'
          ? globalThis.requestAnimationFrame
          : (cb: FrameRequestCallback) =>
              setTimeout(() => cb(performance.now()), 16) as unknown as number;
      rafRef.current = raf(tickProgress);
    }
  }, []);

  const enterProgressing = useCallback(() => {
    phaseRef.current = 'progressing';
    setPhase('progressing');
    progressRef.current = 0;
    setProgress(0);
    // Schedule first frame.
    const raf =
      typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame
        : (cb: FrameRequestCallback) =>
            setTimeout(() => cb(performance.now()), 16) as unknown as number;
    rafRef.current = raf(tickProgress);
  }, [tickProgress]);

  const enterIdle = useCallback(() => {
    phaseRef.current = 'idle';
    setPhase('idle');
    progressRef.current = 0;
    setProgress(0);
    clearVisibilityTimer();
    clearFadeTimer();
    clearSafetyTimer();
    cancelRaf();
  }, []);

  const enterCompleting = useCallback(() => {
    cancelRaf();
    clearSafetyTimer();
    phaseRef.current = 'completing';
    setPhase('completing');
    progressRef.current = 100;
    setProgress(100);
    // Schedule fade-out → idle.
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      enterIdle();
    }, NAV_FADE_OUT_MS);
  }, [enterIdle]);

  const enterPending = useCallback(() => {
    phaseRef.current = 'pending';
    setPhase('pending');
    progressRef.current = 0;
    setProgress(0);
    // Schedule visibility transition → progressing.
    clearVisibilityTimer();
    visibilityTimerRef.current = setTimeout(() => {
      visibilityTimerRef.current = null;
      if (phaseRef.current !== 'pending') return;
      enterProgressing();
    }, NAV_VISIBILITY_DEBOUNCE_MS);
    // Safety timeout — abort the bar after 30 s if no end signal.
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(() => {
      safetyTimerRef.current = null;
      // Force an end regardless of the active sources.
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[ui-status] page progress bar safety-timeout fired');
      }
      navInFlightRef.current = false;
      activeOpsRef.current.clear();
      activeOpsCountRef.current = 0;
      setActivePageOps(0);
      // Snap to completing (no nav to "end" — just close out the bar).
      if (phaseRef.current === 'progressing') enterCompleting();
      else enterIdle();
    }, NAV_SAFETY_TIMEOUT_MS);
  }, [enterCompleting, enterIdle, enterProgressing]);

  /** Recompute the desired phase based on the current "wantsBar" signal. */
  const recompute = useCallback(() => {
    const wants = navInFlightRef.current || activeOpsCountRef.current > 0;
    if (wants) {
      // Transition into the active flow if we're in idle/completing.
      if (phaseRef.current === 'idle' || phaseRef.current === 'completing') {
        clearFadeTimer();
        enterPending();
      }
      // Otherwise (pending/progressing), the existing flow continues.
    } else {
      // No more reasons for the bar.
      if (phaseRef.current === 'pending') {
        // Never showed — straight to idle (no flicker).
        enterIdle();
      } else if (phaseRef.current === 'progressing') {
        enterCompleting();
      }
      // idle/completing: nothing to do.
    }
  }, [enterCompleting, enterIdle, enterPending]);

  // ── Public actions ──────────────────────────────────────────────────────
  const startNavigation = useCallback(() => {
    if (navInFlightRef.current) return;
    navInFlightRef.current = true;
    recompute();
  }, [recompute]);

  const endNavigation = useCallback(() => {
    if (!navInFlightRef.current) return;
    navInFlightRef.current = false;
    recompute();
  }, [recompute]);

  const registerPageOp = useCallback(
    (id: string): (() => void) => {
      if (activeOpsRef.current.has(id)) {
        return () => undefined;
      }
      activeOpsRef.current.add(id);
      activeOpsCountRef.current = activeOpsRef.current.size;
      setActivePageOps(activeOpsCountRef.current);
      recompute();
      let unregistered = false;
      return () => {
        if (unregistered) return;
        unregistered = true;
        activeOpsRef.current.delete(id);
        activeOpsCountRef.current = activeOpsRef.current.size;
        setActivePageOps(activeOpsCountRef.current);
        recompute();
      };
    },
    [recompute],
  );

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearVisibilityTimer();
      clearFadeTimer();
      clearSafetyTimer();
      cancelRaf();
    };
  }, []);

  const value = useMemo<UIStatusContextValue>(
    () => ({
      activePageOps,
      registerPageOp,
      startNavigation,
      endNavigation,
      // Bar is rendered only while progressing or completing — pending is
      // the 100 ms debounce, during which we render nothing so very fast
      // navigations never flash the bar.
      visible: phase === 'progressing' || phase === 'completing',
      progress,
    }),
    [activePageOps, registerPageOp, startNavigation, endNavigation, phase, progress],
  );

  return (
    <UIStatusContext.Provider value={value}>
      {!disablePathnameTracking && <PathnameNavigationEnd />}
      {!disableClickInterception && <ClickNavigationStart />}
      {!disableLocaleTracking && <LocaleNavigationStart />}
      {children}
    </UIStatusContext.Provider>
  );
}

/**
 * Internal — calls `endNavigation()` whenever `usePathname` reports a new
 * path. Search-params changes do NOT end navigation (filter URL writes
 * shouldn't drive the page bar).
 */
function PathnameNavigationEnd() {
  const ctx = useContext(UIStatusContext);
  const pathname = usePathname();
  // Subscribe to searchParams to keep this component in sync, but don't act on it.
  useSearchParams();
  const previousPathRef = useRef<string | null>(pathname);
  const endRef = useRef(ctx?.endNavigation);
  endRef.current = ctx?.endNavigation;

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    endRef.current?.();
  }, [pathname]);

  return null;
}

/**
 * Internal — installs a document-level click interceptor that fires
 * `startNavigation()` when the user clicks an internal anchor. Capture-phase
 * so we observe even if other handlers later stop propagation; we still
 * skip if `defaultPrevented` (someone wants to handle this click manually).
 */
function ClickNavigationStart() {
  const ctx = useContext(UIStatusContext);
  const startRef = useRef(ctx?.startNavigation);
  startRef.current = ctx?.startNavigation;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (!shouldInterceptAnchorClick(e, anchor)) return;
      startRef.current?.();
    };
    document.addEventListener('click', handler, true);
    return () => {
      document.removeEventListener('click', handler, true);
    };
  }, []);

  return null;
}

/**
 * Phase 6 · Iteration 6.16.5 — internal: drives the page progress bar when
 * the active locale changes. The `next-intl` locale switcher uses a cookie
 * + `router.refresh()` flow that bypasses the document-level click
 * interceptor, so without this watcher the bar never appeared during
 * en ↔ he switches. We treat a locale change as a navigation start (and
 * rely on `usePathname` change to fire `endNavigation` once the new
 * subtree mounts).
 */
function LocaleNavigationStart() {
  const ctx = useContext(UIStatusContext);
  const locale = useLocale();
  const previousLocaleRef = useRef<string>(locale);
  const startRef = useRef(ctx?.startNavigation);
  startRef.current = ctx?.startNavigation;

  useEffect(() => {
    if (previousLocaleRef.current === locale) return;
    previousLocaleRef.current = locale;
    startRef.current?.();
  }, [locale]);

  return null;
}

export function useUIStatus(): UIStatusContextValue {
  const ctx = useContext(UIStatusContext);
  if (!ctx) {
    throw new Error('useUIStatus must be used within a UIStatusProvider');
  }
  return ctx;
}

/** Optional accessor — returns null when used outside a provider (used by useAsyncOperation). */
export function useOptionalUIStatus(): UIStatusContextValue | null {
  return useContext(UIStatusContext);
}

/** Visibility + progress for the singleton <PageProgressBar>. */
export function useNavProgress(): { visible: boolean; progress: number } {
  const ctx = useUIStatus();
  return { visible: ctx.visible, progress: ctx.progress };
}
