// Phase 10 · Iteration 10.3 — `/budgets` server shell.

import { BudgetsClient } from './budgets-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function BudgetsPage() {
  return (
    <ProtectedRoute>
      <BudgetsClient />
    </ProtectedRoute>
  );
}
