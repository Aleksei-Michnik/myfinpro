'use client';

import { GROUP_TYPES, type GroupType } from '@myfinpro/shared';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import type { InviteInfo } from '@/lib/group/types';

type InviteErrorKind = 'invalid' | 'expired' | 'used' | 'generic';

const isKnownType = (value: string): value is GroupType =>
  (GROUP_TYPES as readonly string[]).includes(value);

/**
 * Map API errorCode values to a translation-key error kind.
 */
function errorCodeToKind(errorCode: string | undefined): InviteErrorKind {
  switch (errorCode) {
    case 'GROUP_INVITE_TOKEN_INVALID':
      return 'invalid';
    case 'GROUP_INVITE_TOKEN_EXPIRED':
      return 'expired';
    case 'GROUP_INVITE_TOKEN_USED':
      return 'used';
    default:
      return 'generic';
  }
}

function InvitePageInner() {
  const t = useTranslations('groups');
  const params = useParams();
  const router = useRouter();
  const { addToast } = useToast();
  const { isAuthenticated } = useAuth();
  const { getInviteInfo, acceptInvite } = useGroups();

  const token =
    typeof params?.token === 'string'
      ? params.token
      : Array.isArray(params?.token)
        ? params.token[0]
        : '';

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<InviteErrorKind | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  // Load invite info on mount (once we are authenticated)
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    let cancelled = false;
    setIsLoading(true);
    setErrorKind(null);
    getInviteInfo(token)
      .then((info) => {
        if (!cancelled) {
          setInvite(info);
        }
      })
      .catch((err: Error & { errorCode?: string }) => {
        if (!cancelled) {
          setErrorKind(errorCodeToKind(err.errorCode));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, token, getInviteInfo]);

  const handleAccept = async () => {
    if (!invite || isAccepting) return;
    setIsAccepting(true);
    try {
      const group = await acceptInvite(token);
      addToast('success', t('invite.acceptSuccess', { name: group.name }));
      router.push(`/groups/${group.id}`);
    } catch (err) {
      const error = err as Error & { errorCode?: string };
      if (error.errorCode === 'GROUP_ALREADY_A_MEMBER') {
        addToast('info', t('invite.alreadyMember'));
        // Navigate after a short delay so the toast is visible
        setTimeout(() => {
          router.push(`/groups/${invite.groupId}`);
        }, 1500);
      } else {
        const kind = errorCodeToKind(error.errorCode);
        addToast('error', t(`invite.error.${kind}`));
        setIsAccepting(false);
      }
    }
  };

  const handleDecline = () => {
    router.push('/groups');
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="invite-loading"
        >
          <div className="mb-4 h-6 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mb-2 h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mb-6 h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="flex gap-3">
            <div className="h-10 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <p className="sr-only">{t('invite.loading')}</p>
        </div>
      </div>
    );
  }

  if (errorKind) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="invite-error"
        >
          <h1
            className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100"
            data-testid="invite-error-title"
          >
            {t(`invite.error.${errorKind}`)}
          </h1>
          <p
            className="mb-6 text-sm text-gray-600 dark:text-gray-400"
            data-testid="invite-error-kind"
          >
            {errorKind}
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => router.push('/groups')}
            data-testid="invite-go-to-groups-btn"
          >
            {t('invite.goToGroups')}
          </Button>
        </div>
      </div>
    );
  }

  if (!invite) {
    // Shouldn't normally reach here, but guard against it
    return null;
  }

  const typeLabel = isKnownType(invite.groupType)
    ? t(`type.${invite.groupType}`)
    : invite.groupType;

  return (
    <div className="container mx-auto max-w-lg px-4 py-8">
      <div
        className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
        data-testid="invite-card"
      >
        <h1 className="mb-4 text-lg font-medium text-gray-600 dark:text-gray-400">
          {t('invite.joinMessage')}
        </h1>

        <div className="mb-3 flex items-center gap-3">
          <h2
            className="text-2xl font-bold text-gray-900 dark:text-gray-100"
            data-testid="invite-group-name"
          >
            {invite.groupName}
          </h2>
          <span
            className="inline-flex items-center rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
            data-testid="invite-group-type"
          >
            {typeLabel}
          </span>
        </div>

        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400" data-testid="invite-inviter">
          {t('invite.invitedBy', { name: invite.inviterName })}
        </p>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={handleDecline}
            disabled={isAccepting}
            data-testid="invite-decline-btn"
          >
            {t('invite.decline')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1"
            onClick={handleAccept}
            disabled={isAccepting}
            data-testid="invite-accept-btn"
          >
            {isAccepting ? t('invite.accepting') : t('invite.accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <ProtectedRoute>
      <InvitePageInner />
    </ProtectedRoute>
  );
}
