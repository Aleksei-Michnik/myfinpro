// Phase 6 · Iteration 6.16 — Settings → Categories server shell.

import { CategoriesClient } from './categories-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function CategoriesSettingsPage() {
  return (
    <ProtectedRoute>
      <CategoriesClient />
    </ProtectedRoute>
  );
}
