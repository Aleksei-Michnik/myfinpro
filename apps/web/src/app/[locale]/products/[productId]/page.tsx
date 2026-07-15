// Phase 8 · Iteration 8.9 — `/products/[productId]` server shell.

import { ProductDetailClient } from './product-detail-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return (
    <ProtectedRoute>
      <ProductDetailClient productId={productId} />
    </ProtectedRoute>
  );
}
