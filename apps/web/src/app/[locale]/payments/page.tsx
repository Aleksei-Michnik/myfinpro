// Phase 6 · Iteration 6.16 — `/payments` server shell.

import { PaymentsListClient } from './payments-list-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function PaymentsPage() {
  return (
    <ProtectedRoute>
      <PaymentsListClient />
    </ProtectedRoute>
  );
}
