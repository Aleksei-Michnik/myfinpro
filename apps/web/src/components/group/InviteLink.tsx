'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useGroups, type InviteCreatedResult } from '@/lib/group/group-context';

interface InviteLinkProps {
  groupId: string;
}

/**
 * Admin-only component that generates a shareable invite link for the group
 * and lets the admin copy it to the clipboard.
 */
export function InviteLink({ groupId }: InviteLinkProps) {
  const t = useTranslations('groups.settings.invite');
  const locale = useLocale();
  const { createInvite } = useGroups();
  const { addToast } = useToast();

  const [invite, setInvite] = useState<InviteCreatedResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const result = await createInvite(groupId);
      setInvite(result);
    } catch (err) {
      const message = (err as Error).message || t('error');
      addToast('error', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!invite) return;
    const clipboard =
      typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
    if (clipboard) {
      try {
        await clipboard.writeText(invite.inviteUrl);
        addToast('success', t('copied'));
        return;
      } catch {
        // fall through to selection fallback
      }
    }
    // Fallback: select the input text for the user to copy manually.
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    addToast('info', t('copied'));
  };

  const formattedExpiry = invite
    ? new Date(invite.expiresAt).toLocaleString(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

  return (
    <div data-testid="invite-link">
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400" data-testid="invite-description">
        {t('description')}
      </p>

      {!invite && (
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleGenerate}
          disabled={isLoading}
          data-testid="generate-invite-btn"
        >
          {isLoading ? t('generating') : t('generateButton')}
        </Button>
      )}

      {invite && (
        <div className="space-y-3" data-testid="invite-result">
          <div>
            <label
              htmlFor="invite-url-input"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('linkLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="invite-url-input"
                ref={inputRef}
                type="text"
                readOnly
                value={invite.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                data-testid="invite-url-input"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleCopy}
                data-testid="copy-invite-btn"
              >
                {t('copyButton')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="invite-expires">
            {t('expiresOn', { date: formattedExpiry })}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleGenerate}
            disabled={isLoading}
            data-testid="regenerate-invite-btn"
          >
            {isLoading ? t('generating') : t('regenerateButton')}
          </Button>
        </div>
      )}
    </div>
  );
}
