'use client';

import { useTranslations } from 'next-intl';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function DashboardPage() {
  const t = useTranslations('dashboard');

  return (
    <ProtectedRoute>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
        <p className="text-gray-600">{t('welcome')}</p>
      </div>
    </ProtectedRoute>
  );
}
