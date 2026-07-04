// Phase 7 · Iteration 7.8 — `/receipts/[receiptId]` server shell.

import { ReceiptReviewClient } from './receipt-review-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

interface ReceiptDetailPageProps {
  params: Promise<{ receiptId: string }>;
}

export default async function ReceiptDetailPage({ params }: ReceiptDetailPageProps) {
  const { receiptId } = await params;
  return (
    <ProtectedRoute>
      <ReceiptReviewClient receiptId={receiptId} />
    </ProtectedRoute>
  );
}
