// Phase 8 · Iteration 8.9 — `/products` server shell.

import { ProductsClient } from './products-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function ProductsPage() {
  return (
    <ProtectedRoute>
      <ProductsClient />
    </ProtectedRoute>
  );
}
