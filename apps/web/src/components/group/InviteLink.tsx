'use client';

// Phase 20 · Iteration 20.7 — migrated the hand-rolled read-only input + copy
// button onto the kit's <CopyField> (docs/ui/20.7-connector-tokens.md §6):
// copy feedback is now the field's own inline status line instead of a toast.

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyField } from '@/components/ui/CopyField';
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
          <CopyField
            value={invite.inviteUrl}
            label={t('linkLabel')}
            testId="invite-url-input"
            copyTestId="copy-invite-btn"
            copyLabel={t('copyButton')}
            copiedLabel={t('copied')}
          />
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
