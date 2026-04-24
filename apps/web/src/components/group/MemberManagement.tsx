'use client';

import { GROUP_ROLES, type GroupRole } from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useGroups } from '@/lib/group/group-context';
import type { GroupDetail, GroupMember } from '@/lib/group/types';

interface MemberManagementProps {
  group: GroupDetail;
  currentUserId: string;
  onChanged?: () => void;
}

function sortMembers(members: GroupMember[]): GroupMember[] {
  return [...members].sort((a, b) => {
    if (a.role === b.role) {
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    }
    return a.role === 'admin' ? -1 : 1;
  });
}

/**
 * Admin-only component for listing and managing members of a group.
 * Each member row exposes a role dropdown and a remove button.
 */
export function MemberManagement({ group, currentUserId, onChanged }: MemberManagementProps) {
  const t = useTranslations('groups.settings.members');
  const locale = useLocale();
  const { updateMemberRole, removeMember } = useGroups();
  const { addToast } = useToast();

  const sortedMembers = useMemo(() => sortMembers(group.members), [group.members]);

  const [pendingRoleUserId, setPendingRoleUserId] = useState<string | null>(null);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<GroupMember | null>(null);

  const handleRoleChange = async (member: GroupMember, nextRole: GroupRole) => {
    if (member.role === nextRole) return;
    setPendingRoleUserId(member.id);
    try {
      await updateMemberRole(group.id, member.id, nextRole);
      addToast('success', t('roleChangeSuccess'));
      onChanged?.();
    } catch (err) {
      const error = err as Error & { errorCode?: string };
      let key: string = 'errors.generic';
      switch (error.errorCode) {
        case 'GROUP_CANNOT_REMOVE_LAST_ADMIN':
          key = 'errors.cannotRemoveLastAdmin';
          break;
        case 'GROUP_NOT_A_MEMBER':
          key = 'errors.notAMember';
          break;
      }
      addToast('error', t(key));
    } finally {
      setPendingRoleUserId(null);
    }
  };

  const handleOpenConfirm = (member: GroupMember) => {
    setConfirmTarget(member);
  };

  const handleCloseConfirm = () => {
    setConfirmTarget(null);
  };

  const handleConfirmRemove = async () => {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setPendingRemoveUserId(target.id);
    try {
      await removeMember(group.id, target.id);
      addToast('success', t('removeSuccess'));
      setConfirmTarget(null);
      onChanged?.();
    } catch (err) {
      const error = err as Error & { errorCode?: string };
      let key: string = 'errors.generic';
      switch (error.errorCode) {
        case 'GROUP_CANNOT_REMOVE_LAST_ADMIN':
          key = 'errors.cannotRemoveLastAdmin';
          break;
        case 'GROUP_CANNOT_REMOVE_SELF':
          key = 'errors.cannotRemoveSelf';
          break;
        case 'GROUP_NOT_A_MEMBER':
          key = 'errors.notAMember';
          break;
      }
      addToast('error', t(key));
    } finally {
      setPendingRemoveUserId(null);
    }
  };

  return (
    <div data-testid="member-management">
      <ul className="divide-y divide-gray-200 dark:divide-gray-700">
        {sortedMembers.map((member) => {
          const isCurrentUser = member.id === currentUserId;
          const joinedDate = new Date(member.joinedAt).toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
          const initial = (member.name || member.email).charAt(0).toUpperCase();
          const isRolePending = pendingRoleUserId === member.id;

          return (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
              data-testid={`member-row-${member.id}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
                  aria-hidden="true"
                >
                  {initial}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {member.name}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {member.email}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{joinedDate}</p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <label className="sr-only" htmlFor={`role-select-${member.id}`}>
                  {t('roleLabel')}
                </label>
                <select
                  id={`role-select-${member.id}`}
                  data-testid={`role-select-${member.id}`}
                  value={member.role}
                  disabled={isCurrentUser || isRolePending}
                  onChange={(e) => handleRoleChange(member, e.target.value as GroupRole)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  {GROUP_ROLES.map((roleOption) => (
                    <option key={roleOption} value={roleOption}>
                      {t(roleOption)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleOpenConfirm(member)}
                  disabled={isCurrentUser || pendingRemoveUserId === member.id}
                  className="inline-flex items-center rounded-md border border-red-300 bg-white px-2 py-1 text-sm font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-900/30"
                  aria-label={t('removeButton')}
                  data-testid={`remove-member-btn-${member.id}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3"
                    />
                  </svg>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {confirmTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-member-title"
          data-testid="remove-member-dialog"
        >
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3
              id="remove-member-title"
              className="mb-4 text-lg font-semibold text-red-600 dark:text-red-400"
            >
              {t('removeConfirmTitle')}
            </h3>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              {t('removeConfirmMessage', { name: confirmTarget.name })}
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="flex-1"
                onClick={handleCloseConfirm}
                disabled={pendingRemoveUserId === confirmTarget.id}
                data-testid="remove-member-cancel-btn"
              >
                {t('cancelButton')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                className="flex-1 !bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
                onClick={handleConfirmRemove}
                disabled={pendingRemoveUserId === confirmTarget.id}
                data-testid="remove-member-confirm-btn"
              >
                {pendingRemoveUserId === confirmTarget.id ? '...' : t('removeConfirmButton')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
