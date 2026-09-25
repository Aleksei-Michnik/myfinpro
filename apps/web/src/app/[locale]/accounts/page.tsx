// Phase 20 · Iteration 20.3 — `/accounts` server shell.

import { AccountsClient } from './accounts-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function AccountsPage() {
  return (
    <ProtectedRoute>
      <AccountsClient />
    </ProtectedRoute>
  );
}
