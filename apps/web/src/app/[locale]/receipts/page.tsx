// Phase 7 · Iteration 7.7 — `/receipts` server shell.

import { ReceiptsClient } from './receipts-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function ReceiptsPage() {
  return (
    <ProtectedRoute>
      <ReceiptsClient />
    </ProtectedRoute>
  );
}
