'use client';

// Phase 6 · Iteration 6.16.2 — UI status provider for the global async-operation
// infrastructure. Tracks active page-scope operations to drive the singleton
// <PageProgressBar>. Auto-registers a brief flash on Next.js navigations so
// the bar is visible when the user moves between routes.

import { usePathname, useSearchParams } from 'next/navigation';
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
import { generateOpId } from './async-operation';

export interface UIStatusContextValue {
  /** Active page-scope operations count. Drives <PageProgressBar>. */
  activePageOps: number;
  /** Used internally by useAsyncOperation when scope='page'. Returns an unregister fn. */
  registerPageOp(id: string): () => void;
}

const UIStatusContext = createContext<UIStatusContextValue | null>(null);

/** Minimum visible flash duration on route changes (ms). */
const NAVIGATION_FLASH_MS = 250;

export interface UIStatusProviderProps {
  children: ReactNode;
  /** Skip the pathname-change auto-register (useful for tests / non-app embeds). */
  disablePathnameTracking?: boolean;
}

export function UIStatusProvider({ children, disablePathnameTracking }: UIStatusProviderProps) {
  // Track active operation IDs in a ref-backed Set; the count drives the public state.
  const activeOpsRef = useRef<Set<string>>(new Set());
  const [activePageOps, setActivePageOps] = useState(0);

  const registerPageOp = useCallback((id: string): (() => void) => {
    activeOpsRef.current.add(id);
    setActivePageOps(activeOpsRef.current.size);
    let unregistered = false;
    return () => {
      if (unregistered) return;
      unregistered = true;
      activeOpsRef.current.delete(id);
      setActivePageOps(activeOpsRef.current.size);
    };
  }, []);

  const value = useMemo<UIStatusContextValue>(
    () => ({ activePageOps, registerPageOp }),
    [activePageOps, registerPageOp],
  );

  return (
    <UIStatusContext.Provider value={value}>
      {!disablePathnameTracking && <PathnameNavigationFlash />}
      {children}
    </UIStatusContext.Provider>
  );
}

/**
 * Internal — registers a brief 250ms page-scope op whenever `usePathname`
 * changes, giving the user a visible flash on Next.js navigations.
 * Search-params changes do NOT trigger a flash (the page hasn't navigated).
 */
function PathnameNavigationFlash() {
  const ctx = useContext(UIStatusContext);
  const pathname = usePathname();
  // Subscribe to searchParams to keep this component in sync, but don't act on it.
  // (Touching the value re-renders only when search params change.)
  useSearchParams();
  const previousPathRef = useRef<string | null>(pathname);
  // Snapshot the registerPageOp callback in a ref so the effect's dep array
  // doesn't include the ctx object (which changes on every activePageOps tick,
  // which would otherwise trigger the cleanup and unregister our flash op
  // immediately — see iteration 6.16.2 fix).
  const registerRef = useRef(ctx?.registerPageOp);
  registerRef.current = ctx?.registerPageOp;

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    const reg = registerRef.current;
    if (!reg) return;
    const id = generateOpId();
    const unregister = reg(id);
    const timer = setTimeout(unregister, NAVIGATION_FLASH_MS);
    return () => {
      clearTimeout(timer);
      unregister();
    };
  }, [pathname]);

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
