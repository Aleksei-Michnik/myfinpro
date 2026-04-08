'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DeleteAccountDialog } from '@/components/auth/DeleteAccountDialog';
import { DeletionBanner } from '@/components/auth/DeletionBanner';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/auth-context';

export default function AccountSettingsPage() {
  const t = useTranslations('settings.account');
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <ProtectedRoute>
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>

        {user?.scheduledDeletionAt && <DeletionBanner />}

        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('userInfo')}</h2>
          <dl className="space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <dt className="text-sm font-medium text-gray-500">{t('email')}</dt>
              <dd className="text-sm text-gray-900" data-testid="user-email">
                {user?.email}
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <dt className="text-sm font-medium text-gray-500">{t('name')}</dt>
              <dd className="text-sm text-gray-900" data-testid="user-name">
                {user?.name}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm font-medium text-gray-500">{t('provider')}</dt>
              <dd className="text-sm text-gray-900" data-testid="user-provider">
                {user?.email?.includes('@telegram.user') ? 'Telegram' : 'Email'}
              </dd>
            </div>
          </dl>
        </div>

        {!user?.scheduledDeletionAt && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <h2 className="mb-2 text-lg font-semibold text-red-600">{t('deleteAccount')}</h2>
            <p className="mb-4 text-sm text-gray-600">{t('deleteWarning')}</p>
            <Button
              variant="primary"
              size="md"
              className="!bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
              onClick={() => setIsDialogOpen(true)}
              data-testid="open-delete-dialog-btn"
            >
              {t('deleteAccount')}
            </Button>
          </div>
        )}

        <DeleteAccountDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
      </div>
    </ProtectedRoute>
  );
}
