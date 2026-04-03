'use client';

import { useTranslations } from 'next-intl';
import { ConnectedAccounts } from '@/components/auth/ConnectedAccounts';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function ConnectedAccountsPage() {
  const t = useTranslations('settings');

  return (
    <ProtectedRoute>
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">{t('connectedAccounts')}</h1>
        <p className="text-gray-600 mb-6">{t('connectedAccountsDescription')}</p>
        <ConnectedAccounts />
      </div>
    </ProtectedRoute>
  );
}
