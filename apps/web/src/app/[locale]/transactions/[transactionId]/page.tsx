import { TransactionDetailClient } from './transaction-detail-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

interface PageProps {
  params: Promise<{ locale: string; transactionId: string }>;
}

export default async function TransactionDetailPage({ params }: PageProps) {
  const { transactionId } = await params;
  return (
    <ProtectedRoute>
      <TransactionDetailClient transactionId={transactionId} />
    </ProtectedRoute>
  );
}
