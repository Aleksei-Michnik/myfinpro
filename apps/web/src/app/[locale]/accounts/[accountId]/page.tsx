// Phase 20 · Iteration 20.5 — `/accounts/[accountId]` server shell.

import { AccountDetailClient } from './account-detail-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

interface PageProps {
  params: Promise<{ locale: string; accountId: string }>;
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { accountId } = await params;
  return (
    <ProtectedRoute>
      <AccountDetailClient accountId={accountId} />
    </ProtectedRoute>
  );
}
