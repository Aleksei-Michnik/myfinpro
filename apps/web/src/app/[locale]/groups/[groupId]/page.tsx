'use client';

import { GROUP_ROLES, GROUP_TYPES, type GroupRole, type GroupType } from '@myfinpro/shared';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import type { GroupDetail, GroupMember } from '@/lib/group/types';

const isKnownType = (value: string): value is GroupType =>
  (GROUP_TYPES as readonly string[]).includes(value);

const isKnownRole = (value: string): value is GroupRole =>
  (GROUP_ROLES as readonly string[]).includes(value);

/**
 * Sort members by role (admins first) then by joinedAt ascending.
 */
function sortMembers(members: GroupMember[]): GroupMember[] {
  return [...members].sort((a, b) => {
    if (a.role === b.role) {
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    }
    return a.role === 'admin' ? -1 : 1;
  });
}

function GroupDashboardInner() {
  const t = useTranslations('groups');
  const locale = useLocale();
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { getGroup, leaveGroup } = useGroups();
  const { addToast } = useToast();

  const groupId =
    typeof params?.groupId === 'string'
      ? params.groupId
      : Array.isArray(params?.groupId)
        ? params.groupId[0]
        : '';

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Leave group dialog state
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    setIsLoading(true);
    setHasError(false);
    getGroup(groupId)
      .then((detail) => {
        if (!cancelled) {
          setGroup(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasError(true);
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
  }, [groupId, getGroup]);

  const sortedMembers = useMemo(() => (group ? sortMembers(group.members) : []), [group]);

  const currentUserMembership = useMemo(
    () => (group && user ? group.members.find((m) => m.id === user.id) : undefined),
    [group, user],
  );
  const isCurrentUserAdmin = currentUserMembership?.role === 'admin';

  const handleOpenLeaveDialog = () => {
    setIsLeaveDialogOpen(true);
  };

  const handleCloseLeaveDialog = () => {
    if (isLeaving) return;
    setIsLeaveDialogOpen(false);
  };

  const handleConfirmLeave = async () => {
    if (!group) return;
    setIsLeaving(true);
    try {
      await leaveGroup(group.id);
      addToast('success', t('dashboard.leaveSuccess', { name: group.name }));
      router.push('/groups');
    } catch (err) {
      const errorCode = (err as { errorCode?: string }).errorCode;
      if (errorCode === 'GROUP_CANNOT_LEAVE_AS_LAST_ADMIN') {
        addToast('error', t('dashboard.leaveErrors.lastAdmin'));
      } else {
        addToast('error', t('dashboard.leaveErrors.generic'));
      }
      setIsLeaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="group-dashboard-loading"
        >
          <div className="mb-4 h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mb-2 h-4 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mb-6 h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="h-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            ))}
          </div>
          <p className="sr-only">{t('dashboard.loading')}</p>
        </div>
      </div>
    );
  }

  if (hasError || !group) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="group-dashboard-error"
        >
          <h1
            className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100"
            data-testid="group-dashboard-error-title"
          >
            {t('dashboard.notFound')}
          </h1>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => router.push('/groups')}
            data-testid="group-dashboard-back-btn"
          >
            {t('dashboard.backToGroups')}
          </Button>
        </div>
      </div>
    );
  }

  const typeLabel = isKnownType(group.type) ? t(`type.${group.type}`) : group.type;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div
        className="mb-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
        data-testid="group-dashboard-header"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1
              className="text-2xl font-bold text-gray-900 dark:text-gray-100"
              data-testid="group-dashboard-name"
            >
              {group.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
                data-testid="group-dashboard-type-badge"
              >
                {typeLabel}
              </span>
              <span
                className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 font-mono text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                data-testid="group-dashboard-currency-badge"
              >
                {group.defaultCurrency}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCurrentUserAdmin && (
              <Link
                href={`/groups/${group.id}/settings`}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                data-testid="group-dashboard-settings-btn"
              >
                {t('dashboard.settingsButton')}
              </Link>
            )}
            <button
              type="button"
              onClick={handleOpenLeaveDialog}
              className="inline-flex items-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-700 dark:text-red-300 dark:hover:bg-red-900/30"
              data-testid="group-dashboard-leave-btn"
            >
              {t('dashboard.leaveButton')}
            </button>
          </div>
        </div>
      </div>

      {/* Overview */}
      <section
        className="mb-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
        data-testid="group-dashboard-overview"
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('dashboard.overviewTitle')}
        </h2>
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-8 text-center dark:border-gray-600 dark:bg-gray-900/40">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M3 6h18M3 14h18M3 18h18"
              />
            </svg>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.overviewPlaceholder')}
          </p>
        </div>
      </section>

      {/* Members */}
      <section
        className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
        data-testid="group-dashboard-members"
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('dashboard.membersTitle')}{' '}
          <span
            className="text-gray-500 dark:text-gray-400"
            data-testid="group-dashboard-member-count"
          >
            ({t('dashboard.memberCount', { count: sortedMembers.length })})
          </span>
        </h2>

        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {sortedMembers.map((member) => {
            const isYou = user?.id === member.id;
            const initial = (member.name || member.email).charAt(0).toUpperCase();
            const roleLabel = isKnownRole(member.role) ? t(`role.${member.role}`) : member.role;
            const joinedDate = new Date(member.joinedAt).toLocaleDateString(locale, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });
            return (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 py-3"
                data-testid={`group-member-row-${member.id}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
                    aria-hidden="true"
                    data-testid={`group-member-avatar-${member.id}`}
                  >
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
                      data-testid={`group-member-name-${member.id}`}
                    >
                      {member.name}
                      {isYou && (
                        <span
                          className="ml-1 text-gray-500 dark:text-gray-400"
                          data-testid={`group-member-you-${member.id}`}
                        >
                          ({t('dashboard.you')})
                        </span>
                      )}
                    </p>
                    <p
                      className="truncate text-xs text-gray-500 dark:text-gray-400"
                      data-testid={`group-member-email-${member.id}`}
                    >
                      {member.email}
                    </p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  {member.role === 'admin' && (
                    <span
                      className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                      data-testid={`group-member-admin-badge-${member.id}`}
                    >
                      {roleLabel}
                    </span>
                  )}
                  <span
                    className="text-xs text-gray-500 dark:text-gray-400"
                    data-testid={`group-member-joined-${member.id}`}
                  >
                    {t('dashboard.joinedOn', { date: joinedDate })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {isLeaveDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-group-dialog-title"
          data-testid="group-dashboard-leave-dialog"
        >
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h2
              id="leave-group-dialog-title"
              className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('dashboard.leaveConfirmTitle', { name: group.name })}
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.leaveConfirmMessage')}
            </p>
            <div className="mt-6 flex gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="flex-1"
                onClick={handleCloseLeaveDialog}
                disabled={isLeaving}
                data-testid="group-dashboard-leave-cancel-btn"
              >
                {t('dashboard.leaveCancelButton')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                className="flex-1 !bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
                onClick={handleConfirmLeave}
                disabled={isLeaving}
                data-testid="group-dashboard-leave-confirm-btn"
              >
                {isLeaving ? '...' : t('dashboard.leaveConfirmButton')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GroupDashboardPage() {
  return (
    <ProtectedRoute>
      <GroupDashboardInner />
    </ProtectedRoute>
  );
}
