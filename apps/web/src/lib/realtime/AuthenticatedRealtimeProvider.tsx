'use client';

// Phase 6 · Iteration 6.18.1.4 — auth-gated wrapper.
//
// Keeps `RealtimeProvider` agnostic of the auth context: this thin shim
// reads `useAuth()` and toggles `enabled` so the EventSource only opens
// once the user is signed in (and closes on logout).

import type { ReactNode } from 'react';
import { RealtimeProvider } from './realtime-context';
import { useAuth } from '@/lib/auth/auth-context';

export function AuthenticatedRealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return <RealtimeProvider enabled={isAuthenticated}>{children}</RealtimeProvider>;
}
