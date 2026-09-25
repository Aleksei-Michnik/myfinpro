'use client';

// Phase 20 · Iteration 20.7 — Settings → Connector tokens
// (docs/ui/20.7-connector-tokens.md §1). Same shell as `settings/categories`:
// mount-only page-scope fetch, <RetryReturnDialog> back to /settings/account
// on failure, re-fetch on locale change. No realtime — tokens are
// single-user, low-frequency data; freshness is the explicit Refresh control
// (spec §7 — deliberate, not an omission).

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiTokenRow } from '@/components/settings/ApiTokenRow';
import { CreateApiTokenDialog } from '@/components/settings/CreateApiTokenDialog';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { PageHeader } from '@/components/ui/PageHeader';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { Stat } from '@/components/ui/Stat';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { API_TOKEN_MAX, type ApiTokenCreated, type ApiTokenSummary } from '@/lib/auth/types';
import { useApiTokens } from '@/lib/auth/use-api-tokens';
import { useAsyncOperation, useResetOnLocaleChange } from '@/lib/ui';

export function TokensClient() {
  const t = useTranslations('settings.tokens');
  const router = useRouter();
  const { addToast } = useToast();
  const api = useApiTokens();

  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiTokenSummary | null>(null);

  const loadOp = useAsyncOperation<ApiTokenSummary[]>({ scope: 'page' });
  const refreshOp = useAsyncOperation<ApiTokenSummary[]>({
    scope: 'container',
    id: 'tokens-refresh',
  });
  // Boolean sentinel, not <void> — run() resolves `undefined` on failure too,
  // so a void op could not tell success from error (accounts-client's shape).
  const revokeOp = useAsyncOperation<boolean>({ scope: 'control', id: 'token-revoke' });

  const listTokensRef = useRef(api.listTokens);
  listTokensRef.current = api.listTokens;

  const runInitial = useCallback(() => {
    void loadOp
      .run((signal) => listTokensRef.current(signal))
      .then((result) => {
        if (result === undefined) return;
        setTokens(result);
        setHasLoadedOnce(true);
      });
    // loadOp.run is referentially stable.
  }, []);

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runInitial();
  }, [runInitial]);

  useResetOnLocaleChange(() => runInitial());

  const handleRefresh = () => {
    void refreshOp
      .run((signal) => listTokensRef.current(signal))
      .then((result) => {
        if (result !== undefined) setTokens(result);
      });
  };

  const handleCreated = (created: ApiTokenCreated) => {
    // Prepend from the create response — never a refetch (§4 item 4). The raw
    // token must not outlive the reveal panel, so only the summary is kept.
    const { token: _raw, ...summary } = created;
    setTokens((prev) => [summary, ...prev]);
    addToast('success', t('toast.created'));
  };

  const handleRevokeConfirm = () => {
    const token = revoking;
    if (!token) return;
    void revokeOp
      .run(async (signal) => {
        await api.revokeToken(token.id, signal);
        return true;
      })
      .then((ok) => {
        if (!ok) return;
        setTokens((prev) => prev.filter((tk) => tk.id !== token.id));
        setRevoking(null);
        addToast('success', t('revoke.done'));
      });
  };

  useEffect(() => {
    if (revokeOp.error && revokeOp.error.reason !== 'aborted') {
      addToast('error', revokeOp.error.message || t('revoke.failed'));
    }
  }, [revokeOp.error, addToast, t]);

  const isInitialLoading = loadOp.isLoading && !hasLoadedOnce;
  const showInitialError = loadOp.isError && !hasLoadedOnce;
  const showRefreshError =
    refreshOp.isError && refreshOp.error && refreshOp.error.reason !== 'aborted';
  const atLimit = tokens.length >= API_TOKEN_MAX;

  return (
    <main
      className="container mx-auto max-w-3xl space-y-6 px-4 py-8"
      data-testid="tokens-page"
      aria-busy={isInitialLoading || undefined}
    >
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshOp.isLoading}
            aria-busy={refreshOp.isLoading || undefined}
            data-testid="tokens-refresh"
          >
            {t('refresh')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stat
          label={t('active')}
          value={t('activeCount', { count: tokens.length, max: API_TOKEN_MAX })}
          tone={atLimit ? 'warning' : 'neutral'}
          data-testid="tokens-active-stat"
        />
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={atLimit}
          aria-disabled={atLimit || undefined}
          aria-describedby={atLimit ? 'tokens-limit-hint' : undefined}
          data-testid="tokens-new"
        >
          {t('new')}
        </Button>
      </div>
      {atLimit && (
        <p
          id="tokens-limit-hint"
          className="-mt-3 text-xs text-amber-700 dark:text-amber-400"
          data-testid="tokens-limit-hint"
        >
          {t('limitHint', { max: API_TOKEN_MAX })}
        </p>
      )}

      <div className="relative" data-testid="tokens-content">
        {isInitialLoading ? (
          <div
            className="space-y-2"
            role="status"
            aria-label={t('loading')}
            data-testid="tokens-loading"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none dark:bg-gray-800"
              />
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <EmptyState
            data-testid="tokens-empty"
            title={t('emptyTitle')}
            description={
              <>
                {t('emptyBody')}
                <br />
                <Link
                  href="/accounts"
                  data-testid="tokens-empty-import-link"
                  className="text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  {t('emptyPreferImport')}
                </Link>
              </>
            }
            action={
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setCreateOpen(true)}
                data-testid="tokens-new-empty"
              >
                {t('new')}
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2" data-testid="tokens-list">
            {tokens.map((token) => (
              <ApiTokenRow
                key={token.id}
                token={token}
                busy={revokeOp.isLoading}
                onRevoke={setRevoking}
              />
            ))}
          </ul>
        )}

        {showRefreshError && refreshOp.error && (
          <div className="mt-3" data-testid="tokens-error">
            <InlineErrorBanner
              reason={refreshOp.error.reason}
              httpStatus={refreshOp.error.httpStatus}
              onRetry={handleRefresh}
              retrying={refreshOp.isLoading}
            />
          </div>
        )}

        <LoadingOverlay active={refreshOp.isLoading && hasLoadedOnce} />
      </div>

      <CreateApiTokenDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      {revoking && (
        <ConfirmDialog
          title={t('revoke.title')}
          message={t('revoke.warning', { name: revoking.name })}
          confirmLabel={t('revoke.confirm')}
          cancelLabel={t('revoke.cancel')}
          danger
          busy={revokeOp.isLoading}
          onConfirm={handleRevokeConfirm}
          onClose={() => {
            revokeOp.cancel();
            setRevoking(null);
          }}
        />
      )}

      <RetryReturnDialog
        open={showInitialError}
        reason={loadOp.error?.reason ?? 'unknown'}
        httpStatus={loadOp.error?.httpStatus}
        onRetry={() => runInitial()}
        onReturn={() => {
          loadOp.cancel();
          router.replace('/settings/account');
        }}
      />
    </main>
  );
}
