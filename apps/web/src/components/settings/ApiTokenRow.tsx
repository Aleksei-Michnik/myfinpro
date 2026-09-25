'use client';

// Phase 20 · Iteration 20.7 — one row in the /settings/tokens list
// (docs/ui/20.7-connector-tokens.md §3). A single destructive action, so no
// `RowActionsMenu` (that exists for accounts' four actions).

import { useLocale, useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ApiTokenSummary } from '@/lib/auth/types';
import { formatOccurredAt, formatOccurredDate } from '@/lib/transaction/formatters';

const EXPIRING_SOON_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ApiTokenRowProps {
  token: ApiTokenSummary;
  /** Another row's revoke is in flight — disables every row's button. */
  busy?: boolean;
  onRevoke(token: ApiTokenSummary): void;
}

interface ExpiryDisplay {
  tone: BadgeTone;
  label: string;
  expired: boolean;
}

function expiryDisplay(
  expiresAt: string | null,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): ExpiryDisplay {
  if (!expiresAt) return { tone: 'neutral', label: t('noExpiry'), expired: false };
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return { tone: 'neutral', label: t('noExpiry'), expired: false };
  const now = Date.now();
  if (target <= now) return { tone: 'danger', label: t('expired'), expired: true };
  const daysLeft = Math.ceil((target - now) / MS_PER_DAY);
  if (daysLeft <= EXPIRING_SOON_DAYS) {
    return { tone: 'warning', label: t('expiringSoon', { count: daysLeft }), expired: false };
  }
  return {
    tone: 'neutral',
    label: t('expiresOn', { date: formatOccurredDate(expiresAt, locale) }),
    expired: false,
  };
}

export function ApiTokenRow({ token, busy = false, onRevoke }: ApiTokenRowProps) {
  const t = useTranslations('settings.tokens');
  const locale = useLocale();

  const expiry = expiryDisplay(token.expiresAt, locale, t);

  return (
    <Card as="li" padding="sm" muted={expiry.expired} data-testid={`token-row-${token.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="truncate font-medium text-gray-900 dark:text-gray-100"
              title={token.name}
              data-testid={`token-name-${token.id}`}
            >
              {token.name}
            </p>
            <Badge tone="primary" data-testid={`token-scope-${token.id}`}>
              {t('scopes.accountsImport')}
            </Badge>
            <Badge tone={expiry.tone} data-testid={`token-expiry-${token.id}`}>
              <span dir="ltr">{expiry.label}</span>
            </Badge>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            <span data-testid={`token-created-${token.id}`}>
              {t('created')} <span dir="ltr">{formatOccurredAt(token.createdAt, locale)}</span>
            </span>
            <span className="mx-1.5">·</span>
            <span data-testid={`token-last-used-${token.id}`}>
              {token.lastUsedAt ? (
                <>
                  {t('lastUsed')}{' '}
                  <span dir="ltr">{formatOccurredAt(token.lastUsedAt, locale)}</span>
                </>
              ) : (
                t('neverUsed')
              )}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => onRevoke(token)}
          data-testid={`token-revoke-${token.id}`}
        >
          {t('revoke.confirm')}
        </Button>
      </div>
    </Card>
  );
}
