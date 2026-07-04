// Phase 6 · Iteration 6.15 — aggregated dashboard server shell.
// All client-side composition lives in `<DashboardClient>` to keep this file
// minimal and let next-intl resolve the locale-prefixed routing wrapper.

import { DashboardClient } from './dashboard-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardClient />
    </ProtectedRoute>
  );
}
