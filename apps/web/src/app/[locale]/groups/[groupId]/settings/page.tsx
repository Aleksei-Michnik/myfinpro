'use client';

import { CURRENCIES, CURRENCY_CODES, GROUP_TYPES } from '@myfinpro/shared';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { InviteLink } from '@/components/group/InviteLink';
import { MemberManagement } from '@/components/group/MemberManagement';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import type { GroupDetail } from '@/lib/group/types';

function GroupSettingsInner() {
  const t = useTranslations('groups.settings');
  const tGroups = useTranslations('groups');
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { getGroup, updateGroup, deleteGroup } = useGroups();
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

  // Group info form state
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('family');
  const [defaultCurrency, setDefaultCurrency] = useState<string>('USD');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    setIsLoading(true);
    setHasError(false);
    getGroup(groupId)
      .then((detail) => {
        if (cancelled) return;
        setGroup(detail);
        setName(detail.name);
        setType(detail.type);
        setDefaultCurrency(detail.defaultCurrency);
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, getGroup]);

  const currentUserMembership = useMemo(
    () => (group && user ? group.members.find((m) => m.id === user.id) : undefined),
    [group, user],
  );
  const isCurrentUserAdmin = currentUserMembership?.role === 'admin';

  const handleSaveInfo = async (e: FormEvent) => {
    e.preventDefault();
    if (!group) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      await updateGroup(group.id, {
        name: trimmed,
        type,
        defaultCurrency,
      });
      const fresh = await getGroup(group.id);
      setGroup(fresh);
      addToast('success', t('info.saveSuccess'));
    } catch {
      addToast('error', t('info.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefreshGroup = async () => {
    if (!group) return;
    try {
      const fresh = await getGroup(group.id);
      setGroup(fresh);
    } catch {
      // Ignore refresh errors — component will still show stale state.
    }
  };

  const handleOpenDeleteDialog = () => {
    setDeleteConfirmName('');
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    if (isDeleting) return;
    setIsDeleteDialogOpen(false);
  };

  const deleteNameMatches = group ? deleteConfirmName === group.name : false;

  const handleConfirmDelete = async () => {
    if (!group || !deleteNameMatches) return;
    setIsDeleting(true);
    try {
      await deleteGroup(group.id);
      addToast('success', t('dangerZone.deleteSuccess'));
      router.push('/groups');
    } catch {
      addToast('error', t('dangerZone.deleteError'));
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="group-settings-loading"
        >
          <div className="mb-4 h-8 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="space-y-3">
            <div className="h-10 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <p className="sr-only">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (hasError || !group) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="group-settings-error"
        >
          <h1 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
            {tGroups('dashboard.notFound')}
          </h1>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => router.push('/groups')}
            data-testid="group-settings-back-to-groups-btn"
          >
            {t('backToGroups')}
          </Button>
        </div>
      </div>
    );
  }

  if (!isCurrentUserAdmin) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 dark:border-yellow-800 dark:bg-yellow-950"
          data-testid="group-settings-no-permission"
        >
          <h1 className="mb-4 text-xl font-semibold text-yellow-800 dark:text-yellow-200">
            {t('noPermission')}
          </h1>
          <Link
            href={`/groups/${group.id}`}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
            data-testid="group-settings-back-to-group-btn"
          >
            {t('backToGroup')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1
        className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100"
        data-testid="group-settings-title"
      >
        {t('title')}
      </h1>

      {/* Group Info */}
      <section
        className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
        data-testid="group-settings-info"
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('info.title')}
        </h2>
        <form onSubmit={handleSaveInfo} className="space-y-4" noValidate>
          <Input
            name="group-name"
            type="text"
            label={t('info.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
            required
            data-testid="group-settings-name-input"
          />

          <div>
            <label
              htmlFor="group-settings-type-select"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('info.typeLabel')}
            </label>
            <select
              id="group-settings-type-select"
              data-testid="group-settings-type-select"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {GROUP_TYPES.map((groupType) => (
                <option key={groupType} value={groupType}>
                  {tGroups(`type.${groupType}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="group-settings-currency-select"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('info.currencyLabel')}
            </label>
            <select
              id="group-settings-currency-select"
              data-testid="group-settings-currency-select"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {CURRENCIES[code].symbol} {code} — {CURRENCIES[code].name}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSaving || !name.trim()}
            data-testid="group-settings-save-btn"
          >
            {isSaving ? t('info.saving') : t('info.saveButton')}
          </Button>
        </form>
      </section>

      {/* Invite */}
      <section
        className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
        data-testid="group-settings-invite-section"
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('invite.title')}
        </h2>
        <InviteLink groupId={group.id} />
      </section>

      {/* Members */}
      <section
        className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
        data-testid="group-settings-members-section"
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('members.title', { count: group.members.length })}
        </h2>
        <MemberManagement
          group={group}
          currentUserId={user?.id ?? ''}
          onChanged={handleRefreshGroup}
        />
      </section>

      {/* Danger Zone */}
      <section
        className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950"
        data-testid="group-settings-danger-zone"
      >
        <h2 className="mb-2 text-lg font-semibold text-red-600 dark:text-red-400">
          {t('dangerZone.title')}
        </h2>
        <h3 className="mb-2 text-base font-medium text-gray-900 dark:text-gray-100">
          {t('dangerZone.deleteHeading')}
        </h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t('dangerZone.deleteDescription')}
        </p>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="!bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
          onClick={handleOpenDeleteDialog}
          data-testid="group-settings-open-delete-btn"
        >
          {t('dangerZone.deleteButton')}
        </Button>
      </section>

      {isDeleteDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-group-dialog-title"
          data-testid="group-settings-delete-dialog"
        >
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h2
              id="delete-group-dialog-title"
              className="mb-4 text-lg font-semibold text-red-600 dark:text-red-400"
            >
              {t('dangerZone.dialogTitle', { name: group.name })}
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              {t('dangerZone.dialogMessage')}
            </p>

            <Input
              name="confirm-group-name"
              type="text"
              placeholder={t('dangerZone.dialogInputPlaceholder')}
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              disabled={isDeleting}
              autoComplete="off"
              data-testid="group-settings-delete-confirm-input"
            />

            {deleteConfirmName.length > 0 && !deleteNameMatches && (
              <p
                className="mt-2 text-xs text-red-600 dark:text-red-400"
                data-testid="group-settings-delete-mismatch"
              >
                {t('dangerZone.mismatchError')}
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="flex-1"
                onClick={handleCloseDeleteDialog}
                disabled={isDeleting}
                data-testid="group-settings-delete-cancel-btn"
              >
                {t('dangerZone.dialogCancelButton')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                className="flex-1 !bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
                onClick={handleConfirmDelete}
                disabled={!deleteNameMatches || isDeleting}
                data-testid="group-settings-delete-confirm-btn"
              >
                {isDeleting ? '...' : t('dangerZone.dialogConfirmButton')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GroupSettingsPage() {
  return (
    <ProtectedRoute>
      <GroupSettingsInner />
    </ProtectedRoute>
  );
}
