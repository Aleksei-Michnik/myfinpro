'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useTelegramLogin, type TelegramLoginResult } from '@/components/auth/TelegramLoginButton';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth/auth-context';

const TELEGRAM_BOT_ID = process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID;
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

/** Shape returned by GET /auth/connected-accounts */
interface ConnectedAccountsData {
  hasPassword: boolean;
  providers: Array<{
    provider: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    connectedAt: string;
  }>;
}

export function ConnectedAccounts() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const { accessToken } = useAuth();
  const { addToast } = useToast();

  const [data, setData] = useState<ConnectedAccountsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [linkingTelegram, setLinkingTelegram] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/auth/connected-accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch connected accounts');
      const result: ConnectedAccountsData = await res.json();
      setData(result);
      setError(null);
    } catch {
      setError('Failed to load connected accounts');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleLinkTelegram = useCallback(
    async (result: TelegramLoginResult) => {
      if (!accessToken) return;
      setLinkingTelegram(true);
      try {
        const res = await fetch(`${API_BASE}/auth/link/telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(result),
        });
        if (res.status === 409) {
          addToast('error', t('alreadyLinked', { provider: 'Telegram' }));
          return;
        }
        if (!res.ok) {
          addToast('error', t('linkError', { provider: 'Telegram' }));
          return;
        }
        const updated: ConnectedAccountsData = await res.json();
        setData(updated);
        addToast('success', t('linkSuccess', { provider: 'Telegram' }));
      } catch {
        addToast('error', t('linkError', { provider: 'Telegram' }));
      } finally {
        setLinkingTelegram(false);
      }
    },
    [accessToken, addToast, t],
  );

  const { triggerLogin: triggerTelegramLink, isLoading: isTelegramLoading } = useTelegramLogin({
    botId: TELEGRAM_BOT_ID || '',
    onAuth: handleLinkTelegram,
    onError: () => {
      // User cancelled — no action needed
    },
  });

  const handleDisconnect = useCallback(
    async (provider: string) => {
      if (!accessToken) return;
      setDisconnecting(provider);
      setConfirmDisconnect(null);
      try {
        const res = await fetch(`${API_BASE}/auth/connected-accounts/${provider}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: '' }));
          const msg = (body as { message?: string }).message || '';
          if (
            msg.includes('Cannot unlink the last') ||
            (body as { errorCode?: string }).errorCode === 'CANNOT_UNLINK_LAST_AUTH'
          ) {
            addToast('error', t('cannotDisconnectLast'));
          } else {
            addToast('error', t('disconnectError', { provider }));
          }
          return;
        }
        const updated: ConnectedAccountsData = await res.json();
        setData(updated);
        addToast('success', t('disconnectSuccess', { provider }));
      } catch {
        addToast('error', t('disconnectError', { provider }));
      } finally {
        setDisconnecting(null);
      }
    },
    [accessToken, addToast, t],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12" data-testid="loading-spinner">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4" role="alert" data-testid="error-message">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const googleProvider = data.providers.find((p) => p.provider === 'google');
  const telegramProvider = data.providers.find((p) => p.provider === 'telegram');

  return (
    <div className="space-y-4" data-testid="connected-accounts">
      {/* Email & Password Card */}
      <div className="rounded-lg border border-gray-200 p-4 flex items-center justify-between dark:border-gray-700">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('emailPassword')}
          </h3>
          {data.hasPassword ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 mt-1">
              {t('connected')}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 mt-1">
              {t('notConnected')}
            </span>
          )}
        </div>
      </div>

      {/* Google Card */}
      <div className="rounded-lg border border-gray-200 p-4 flex items-center justify-between dark:border-gray-700">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Google</h3>
          {googleProvider ? (
            <>
              <p className="text-sm text-gray-500 mt-0.5">
                {googleProvider.name || googleProvider.email}
              </p>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 mt-1">
                {t('connected')}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 mt-1">
              {t('notConnected')}
            </span>
          )}
        </div>
        <div>
          {googleProvider ? (
            confirmDisconnect === 'google' ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDisconnect('google')}
                  disabled={disconnecting === 'google'}
                >
                  {disconnecting === 'google' ? '...' : t('disconnect')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmDisconnect(null)}>
                  {tCommon('cancel')}
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect('google')}>
                {t('disconnect')}
              </Button>
            )
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = '/api/v1/auth/google';
              }}
            >
              {t('connectGoogle')}
            </Button>
          )}
        </div>
      </div>

      {/* Telegram Card */}
      <div className="rounded-lg border border-gray-200 p-4 flex items-center justify-between dark:border-gray-700">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Telegram</h3>
          {telegramProvider ? (
            <>
              <p className="text-sm text-gray-500 mt-0.5">{telegramProvider.name}</p>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 mt-1">
                {t('connected')}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 mt-1">
              {t('notConnected')}
            </span>
          )}
        </div>
        <div>
          {telegramProvider ? (
            confirmDisconnect === 'telegram' ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDisconnect('telegram')}
                  disabled={disconnecting === 'telegram'}
                >
                  {disconnecting === 'telegram' ? '...' : t('disconnect')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmDisconnect(null)}>
                  {tCommon('cancel')}
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect('telegram')}>
                {t('disconnect')}
              </Button>
            )
          ) : TELEGRAM_BOT_ID ? (
            <Button
              variant="outline"
              size="sm"
              onClick={triggerTelegramLink}
              disabled={linkingTelegram || isTelegramLoading}
            >
              {linkingTelegram || isTelegramLoading ? '...' : t('connectTelegram')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled className="opacity-50">
              {t('connectTelegram')}
            </Button>
          )}
        </div>
      </div>

      {/* Confirm disconnect dialog */}
      {confirmDisconnect && (
        <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800" role="alert">
          {t('disconnectConfirm', { provider: confirmDisconnect })}
        </div>
      )}
    </div>
  );
}
