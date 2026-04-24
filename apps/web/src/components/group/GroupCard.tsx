'use client';

import { GROUP_ROLES, GROUP_TYPES, type GroupRole, type GroupType } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { GroupSummary } from '@/lib/group/types';

interface GroupCardProps {
  group: GroupSummary;
}

const isKnownType = (value: string): value is GroupType =>
  (GROUP_TYPES as readonly string[]).includes(value);

const isKnownRole = (value: string): value is GroupRole =>
  (GROUP_ROLES as readonly string[]).includes(value);

export function GroupCard({ group }: GroupCardProps) {
  const t = useTranslations('groups');

  const typeLabel = isKnownType(group.type) ? t(`type.${group.type}`) : group.type;
  const roleLabel = group.role && isKnownRole(group.role) ? t(`role.${group.role}`) : group.role;

  return (
    <Link
      href={`/groups/${group.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
      data-testid={`group-card-${group.id}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          data-testid="group-name"
        >
          {group.name}
        </h3>
        <span
          className="inline-flex items-center rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
          data-testid="group-type"
        >
          {typeLabel}
        </span>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <span data-testid="group-member-count">
          {t('memberCount', { count: group.memberCount })}
        </span>
        <span className="font-mono text-gray-500 dark:text-gray-400" data-testid="group-currency">
          {group.defaultCurrency}
        </span>
      </div>

      {group.role && (
        <div className="mt-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              group.role === 'admin'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
            }`}
            data-testid="group-role"
          >
            {roleLabel}
          </span>
        </div>
      )}
    </Link>
  );
}
