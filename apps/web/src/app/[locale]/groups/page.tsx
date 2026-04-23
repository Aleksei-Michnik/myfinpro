'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CreateGroupDialog } from '@/components/group/CreateGroupDialog';
import { GroupCard } from '@/components/group/GroupCard';
import { Button } from '@/components/ui/Button';
import { useGroups } from '@/lib/group/group-context';

export default function GroupsPage() {
  const t = useTranslations('groups');
  const { groups, isLoading } = useGroups();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const hasGroups = groups.length > 0;

  return (
    <ProtectedRoute>
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          {hasGroups && (
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsDialogOpen(true)}
              data-testid="open-create-group-btn"
            >
              {t('createGroup')}
            </Button>
          )}
        </div>

        {isLoading && !hasGroups ? (
          <div
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            data-testid="groups-loading-skeleton"
          >
            {Array.from({ length: 2 }).map((_, idx) => (
              <div
                key={idx}
                className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
              />
            ))}
          </div>
        ) : !hasGroups ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800"
            data-testid="groups-empty-state"
          >
            <p className="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
              {t('noGroups')}
            </p>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">{t('createFirst')}</p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setIsDialogOpen(true)}
              data-testid="open-create-group-btn-empty"
            >
              {t('createGroup')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="groups-grid">
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </div>
        )}

        <CreateGroupDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
      </div>
    </ProtectedRoute>
  );
}
