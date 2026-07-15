// Phase 6 · Iteration 6.16 — `/transactions` server shell.

import { TransactionsListClient } from './transactions-list-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function TransactionsPage() {
  return (
    <ProtectedRoute>
      <TransactionsListClient />
    </ProtectedRoute>
  );
}
