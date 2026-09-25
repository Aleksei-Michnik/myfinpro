'use client';

// Phase 20 · Iteration 20.7 — the create-token dialog: two panels of one
// <Dialog> (docs/ui/20.7-connector-tokens.md §4). Panel A collects the name
// and the expiry; on success the same dialog swaps in Panel B, the show-once
// reveal — no route change, no remount (the secret must not survive a
// navigation). `API_TOKEN_LIMIT_REACHED` is caught inside the op (the
// `AccountFormDialog` domain-error shape) so it can disable the primary
// instead of only showing the generic banner.

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopyField } from '@/components/ui/CopyField';
import { Dialog } from '@/components/ui/Dialog';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Link } from '@/i18n/navigation';
import { API_TOKEN_MAX, type ApiTokenCreated } from '@/lib/auth/types';
import { useApiTokens } from '@/lib/auth/use-api-tokens';
import { useAsyncOperation } from '@/lib/ui';

export interface CreateApiTokenDialogProps {
  open: boolean;
  onClose(): void;
  onCreated(token: ApiTokenCreated): void;
}

type ExpiryOption = '30' | '90' | '365' | 'never';
const EXPIRY_DAYS: Record<Exclude<ExpiryOption, 'never'>, number> = {
  '30': 30,
  '90': 90,
  '365': 365,
};
const DEFAULT_EXPIRY: ExpiryOption = '90';

// The package is private and unpublished: printing an `npx @myfinpro/…` line
// would send users to whatever a squatter publishes under that name (security
// review, finding 1). Until the owner publishes it, the commands run from a
// checkout of the repository.
const CONNECTOR_COMMANDS =
  'pnpm --filter @myfinpro/connector build\n' +
  'node apps/connector/dist/main.js init\n' +
  'node apps/connector/dist/main.js sync';

function expiresAtFor(option: ExpiryOption): string | undefined {
  if (option === 'never') return undefined;
  const days = EXPIRY_DAYS[option];
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function CreateApiTokenDialog({ open, onClose, onCreated }: CreateApiTokenDialogProps) {
  const t = useTranslations('settings.tokens.form');
  const tReveal = useTranslations('settings.tokens.reveal');
  const tScopes = useTranslations('settings.tokens.scopes');
  const api = useApiTokens();

  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<ExpiryOption>(DEFAULT_EXPIRY);
  const [nameError, setNameError] = useState<string | undefined>();
  const [limitReached, setLimitReached] = useState(false);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const createOp = useAsyncOperation<ApiTokenCreated>({ scope: 'control', id: 'token-create' });
  const isLoading = createOp.isLoading;

  useEffect(() => {
    if (open) {
      setName('');
      setExpiry(DEFAULT_EXPIRY);
      setNameError(undefined);
      setLimitReached(false);
      setCreated(null);
      setConfirmCloseOpen(false);
      createOp.reset();
    } else {
      createOp.cancel();
    }
    // createOp identity is stable — including it would re-fire on unrelated churn.
  }, [open]);

  useEffect(() => {
    if (open && !created && nameRef.current) nameRef.current.focus();
  }, [open, created]);

  if (!open) return null;

  function validate(): boolean {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('validation.nameRequired'));
      return false;
    }
    if (trimmed.length > 60) {
      setNameError(t('validation.nameTooLong'));
      return false;
    }
    setNameError(undefined);
    return true;
  }

  function handleSubmit() {
    setLimitReached(false);
    if (!validate()) return;

    void createOp
      .run(async (signal) => {
        try {
          return await api.createToken(
            { name: name.trim(), expiresAt: expiresAtFor(expiry) },
            signal,
          );
        } catch (err) {
          const code =
            err instanceof Error ? (err as Error & { errorCode?: string }).errorCode : undefined;
          if (code === 'API_TOKEN_LIMIT_REACHED') {
            setLimitReached(true);
            // A domain error, not a transport failure — resolve to idle
            // rather than showing the generic banner (AccountFormDialog's
            // established shape for domain-error mapping).
            throw new DOMException('domain', 'AbortError');
          }
          throw err;
        }
      })
      .then((result) => {
        if (result === undefined) return;
        setCreated(result);
        onCreated(result);
      });
  }

  function finishClose() {
    // Drop the secret the moment the reveal closes (security review, finding 2).
    setCreated(null);
    createOp.cancel();
    onClose();
  }

  function requestClose() {
    if (created) {
      setConfirmCloseOpen(true);
    } else {
      finishClose();
    }
  }

  const showGenericError =
    createOp.isError && !limitReached && createOp.error?.reason !== 'aborted';

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title={created ? tReveal('title') : t('title')}
        testId="token-create-dialog"
        size="md"
        busy={isLoading}
        initialFocusRef={nameRef}
      >
        {!created ? (
          <form
            noValidate
            aria-busy={isLoading || undefined}
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="mb-3">
              <Input
                ref={nameRef}
                id="token-form-name"
                label={t('name')}
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                disabled={isLoading}
                data-testid="token-form-name"
                error={nameError}
                errorTestId="token-form-error-name"
                size="sm"
              />
            </div>

            <div className="mb-3">
              <Select
                id="token-form-expiry"
                label={t('expiry')}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as ExpiryOption)}
                disabled={isLoading}
                data-testid="token-form-expiry"
                size="sm"
              >
                <option value="90">{t('expiryOptions.d90')}</option>
                <option value="30">{t('expiryOptions.d30')}</option>
                <option value="365">{t('expiryOptions.d365')}</option>
                <option value="never">{t('expiryOptions.never')}</option>
              </Select>
            </div>

            <div
              className="mb-3 rounded-md border border-gray-200 p-3 dark:border-gray-700"
              data-testid="token-form-scope"
            >
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('scope')}
              </p>
              <Badge tone="primary" className="mb-1.5">
                {tScopes('accountsImport')}
              </Badge>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t('scopeFixed')}</p>
            </div>

            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('reach')}</p>

            {(showGenericError || limitReached) && (
              <div className="mb-3" data-testid="token-form-error">
                {limitReached ? (
                  <InlineErrorBanner
                    reason="http"
                    message={t('limitError', { max: API_TOKEN_MAX })}
                  />
                ) : (
                  createOp.error && (
                    <InlineErrorBanner
                      reason={createOp.error.reason}
                      httpStatus={createOp.error.httpStatus}
                      message={t('errorGeneric')}
                      onRetry={() => void createOp.retry()}
                      retrying={isLoading}
                    />
                  )
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="flex-1"
                onClick={requestClose}
                disabled={isLoading}
                data-testid="token-form-cancel"
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="flex-1"
                disabled={isLoading || limitReached}
                aria-busy={isLoading}
                data-testid="token-form-submit"
              >
                {isLoading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <ButtonSpinner />
                    <span>{t('creating')}</span>
                  </span>
                ) : (
                  t('create')
                )}
              </Button>
            </div>
          </form>
        ) : (
          <div data-testid="token-reveal">
            <div
              role="alert"
              id="token-reveal-warning"
              data-testid="token-reveal-warning"
              className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
            >
              {tReveal('warning')}
            </div>

            <CopyField
              value={created.token}
              label={tReveal('tokenLabel')}
              describedById="token-reveal-warning"
              testId="token-reveal-value"
              copyTestId="token-reveal-copy"
              statusTestId="token-reveal-status"
              copyLabel={tReveal('copy')}
              copiedLabel={tReveal('copied')}
              copyFailedLabel={tReveal('copyFailed')}
              autoFocus
              className="mb-4"
            />

            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {tReveal('next')}
            </h3>
            <CopyField
              value={CONNECTOR_COMMANDS}
              label={tReveal('commandsLabel')}
              multiline
              testId="token-reveal-commands"
              copyLabel={tReveal('copy')}
              copiedLabel={tReveal('copied')}
              copyFailedLabel={tReveal('copyFailed')}
              className="mb-3"
            />
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{tReveal('initHint')}</p>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{tReveal('syncHint')}</p>

            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              <Link
                href="/help#connector"
                data-testid="token-reveal-help-link"
                className="text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                {tReveal('helpLink')}
              </Link>
              {' · '}
              {tReveal('reviewHint')}
            </p>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={finishClose}
                data-testid="token-reveal-done"
              >
                {tReveal('done')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {confirmCloseOpen && (
        <ConfirmDialog
          title={tReveal('title')}
          message={tReveal('closeConfirm')}
          confirmLabel={tReveal('closeConfirmConfirm')}
          cancelLabel={t('cancel')}
          stacked
          onConfirm={finishClose}
          onClose={() => setConfirmCloseOpen(false)}
        />
      )}
    </>
  );
}
