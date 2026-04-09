'use client';

import { useTranslations } from 'next-intl';
import { DeletionBanner } from '@/components/auth/DeletionBanner';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/lib/auth/auth-context';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { user } = useAuth();

  return (
    <ProtectedRoute>
      {user?.scheduledDeletionAt && <DeletionBanner />}
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
        <p className="text-gray-600">{t('welcome')}</p>
      </div>
    </ProtectedRoute>
  );
}
