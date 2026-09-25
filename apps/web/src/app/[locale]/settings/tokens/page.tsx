// Phase 20 · Iteration 20.7 — Settings → Connector tokens server shell.

import { TokensClient } from './tokens-client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function TokensSettingsPage() {
  return (
    <ProtectedRoute>
      <TokensClient />
    </ProtectedRoute>
  );
}
