'use client';

import { CURRENCIES, CURRENCY_CODES } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useState, useMemo } from 'react';
import { ConnectedAccounts } from '@/components/auth/ConnectedAccounts';
import { DeleteAccountDialog } from '@/components/auth/DeleteAccountDialog';
import { DeletionBanner } from '@/components/auth/DeletionBanner';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth/auth-context';

export default function AccountSettingsPage() {
  const t = useTranslations('settings.account');
  const tSettings = useTranslations('settings');
  const { user, updateProfile } = useAuth();
  const { addToast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(user?.defaultCurrency || 'USD');
  const [selectedTimezone, setSelectedTimezone] = useState(user?.timezone || 'UTC');
  const [isSaving, setIsSaving] = useState(false);

  const timezones = useMemo(() => {
    try {
      const zones = Intl.supportedValuesOf('timeZone');
      if (!zones.includes('UTC')) {
        zones.unshift('UTC');
      }
      return zones;
    } catch {
      return ['UTC', 'America/New_York', 'Europe/London', 'Asia/Jerusalem', 'Asia/Tokyo'];
    }
  }, []);

  const handleSavePreferences = async () => {
    setIsSaving(true);
    try {
      await updateProfile({
        defaultCurrency: selectedCurrency,
        timezone: selectedTimezone,
      });
      addToast('success', t('preferencesSaved'));
    } catch {
      addToast('error', t('preferencesError'));
    } finally {
      setIsSaving(false);
    }
  };

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

        {/* Preferences section */}
        <div
          className="mb-8 rounded-lg border border-gray-200 bg-white p-6"
          data-testid="preferences-section"
        >
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('preferences')}</h2>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="currency-select"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                {t('defaultCurrency')}
              </label>
              <select
                id="currency-select"
                data-testid="currency-select"
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {CURRENCIES[code].symbol} {code} — {CURRENCIES[code].name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="timezone-select"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                {t('timezone')}
              </label>
              <select
                id="timezone-select"
                data-testid="timezone-select"
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={handleSavePreferences}
              disabled={isSaving}
              data-testid="save-preferences-btn"
            >
              {isSaving ? '...' : t('savePreferences')}
            </Button>
          </div>
        </div>

        {/* Connected Accounts section */}
        <div
          className="mb-8 rounded-lg border border-gray-200 bg-white p-6"
          data-testid="connected-accounts-section"
        >
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            {tSettings('connectedAccounts')}
          </h2>
          <p className="mb-4 text-sm text-gray-600">{tSettings('connectedAccountsDescription')}</p>
          <ConnectedAccounts />
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
