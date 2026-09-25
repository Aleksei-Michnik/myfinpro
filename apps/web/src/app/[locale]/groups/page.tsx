'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CreateGroupDialog } from '@/components/group/CreateGroupDialog';
import { GroupCard } from '@/components/group/GroupCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useGroups } from '@/lib/group/group-context';

export default function GroupsPage() {
  const t = useTranslations('groups');
  const { groups, isLoading } = useGroups();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const hasGroups = groups.length > 0;

  return (
    <ProtectedRoute>
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          className="mb-6"
          title={t('title')}
          actions={
            hasGroups ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setIsDialogOpen(true)}
                data-testid="open-create-group-btn"
              >
                {t('createGroup')}
              </Button>
            ) : undefined
          }
        />

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
          <EmptyState
            data-testid="groups-empty-state"
            title={t('noGroups')}
            description={t('createFirst')}
            action={
              <Button
                variant="primary"
                size="lg"
                onClick={() => setIsDialogOpen(true)}
                data-testid="open-create-group-btn-empty"
              >
                {t('createGroup')}
              </Button>
            }
          />
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
