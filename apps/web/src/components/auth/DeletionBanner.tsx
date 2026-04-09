'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth/auth-context';

export function DeletionBanner() {
  const { user, isAuthenticated, cancelDeletion } = useAuth();
  const t = useTranslations('settings.account');
  const { addToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  if (!isAuthenticated || !user) return null;
  if (!user.scheduledDeletionAt) return null;

  const deletionDate = new Date(user.scheduledDeletionAt).toLocaleDateString();

  const handleCancel = async () => {
    setIsLoading(true);
    try {
      await cancelDeletion();
      addToast('success', t('cancelDeletionSuccess'));
    } catch {
      addToast('error', 'Failed to cancel deletion');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="deletion-banner"
      className="flex items-center justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-3 text-red-900"
    >
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden="true">⚠</span>
        <span data-testid="deletion-message">{t('deletionScheduled', { date: deletionDate })}</span>
      </div>
      <button
        onClick={handleCancel}
        disabled={isLoading}
        className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        data-testid="cancel-deletion-btn"
      >
        {isLoading ? '...' : t('cancelDeletion')}
      </button>
    </div>
  );
}
