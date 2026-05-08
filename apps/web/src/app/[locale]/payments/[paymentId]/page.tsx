import { PaymentDetailClient } from './payment-detail-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

interface PageProps {
  params: Promise<{ locale: string; paymentId: string }>;
}

export default async function PaymentDetailPage({ params }: PageProps) {
  const { paymentId } = await params;
  return (
    <ProtectedRoute>
      <PaymentDetailClient paymentId={paymentId} />
    </ProtectedRoute>
  );
}
