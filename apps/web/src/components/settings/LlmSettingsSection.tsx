'use client';

// Phase 8.11 — "AI model" card on Settings → Account (runbook §9).
// Model picker over the shared catalog (unavailable models stay visible but
// disabled — adding a key unlocks them) plus per-provider BYOK key rows.
// Keys are write-only: the server returns just a last-4 hint, so the UI never
// holds a stored key. Credential writes may 401 with LLM_REAUTH_REQUIRED on
// a long-idle session — surfaced as a "sign in again" toast.

import { LLM_PROVIDERS, type LlmProvider } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { LlmCatalogResponse, LlmCredentialHint } from '@/lib/llm/types';
import { useLlmApi } from '@/lib/llm/use-llm-api';
import { useAsyncOperation } from '@/lib/ui';

/** Brand names — not translated. */
const PROVIDER_NAMES: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};
const KEY_PLACEHOLDERS: Record<LlmProvider, string> = {
  anthropic: 'sk-ant-…',
  openai: 'sk-…',
};

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ' +
  'dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

/** Strip the provider brand from catalog labels shown inside its optgroup. */
function modelLabel(label: string, provider: LlmProvider): string {
  const prefix = `${PROVIDER_NAMES[provider]} `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

export function LlmSettingsSection() {
  const t = useTranslations('settings.account.llm');
  const llmApi = useLlmApi();
  const { addToast } = useToast();

  const [catalog, setCatalog] = useState<LlmCatalogResponse | null>(null);
  const [selectedValue, setSelectedValue] = useState('');

  const loadOp = useAsyncOperation<LlmCatalogResponse>({ scope: 'container' });
  const saveOp = useAsyncOperation<unknown>({ scope: 'control' });

  const reload = useCallback(() => {
    void loadOp.run(async (signal) => {
      const data = await llmApi.fetchCatalog(signal);
      setCatalog(data);
      setSelectedValue(data.selection ? `${data.selection.provider}::${data.selection.model}` : '');
      return data;
    });
    // loadOp.run is referentially stable — safe to omit from deps.
  }, [llmApi]);

  // Mount-only on purpose: reload identity follows llmApi, and re-fetching
  // the catalog on identity churn would loop; later loads happen explicitly.
  useEffect(() => {
    reload();
  }, []);

  const handleSaveModel = () => {
    const [provider, model] = selectedValue
      ? (selectedValue.split('::') as [string, string])
      : [null, null];
    void saveOp
      .run((signal) => llmApi.updateSelection(provider, model, signal))
      .then((result) => {
        if (result !== undefined) {
          addToast('success', t('modelSaved'));
          reload();
        }
      });
  };

  useEffect(() => {
    if (saveOp.error && saveOp.error.reason !== 'aborted') {
      addToast('error', saveOp.error.message || t('saveFailed'));
    }
  }, [saveOp.error, addToast, t]);

  return (
    <div
      className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
      data-testid="llm-section"
    >
      <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t('description')}</p>

      {loadOp.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          data-testid="llm-load-error"
        >
          <span>{t('loadFailed')}</span>
          <Button variant="outline" size="sm" onClick={() => void loadOp.retry()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {!catalog && loadOp.isLoading && (
        <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
          {t('loading')}
        </p>
      )}

      {catalog && (
        <div className="space-y-6">
          <div>
            <label
              htmlFor="llm-model-select"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('modelLabel')}
            </label>
            <select
              id="llm-model-select"
              data-testid="llm-model-select"
              value={selectedValue}
              onChange={(e) => setSelectedValue(e.target.value)}
              aria-describedby="llm-model-hint"
              className={inputClass}
            >
              <option value="">{t('defaultOption')}</option>
              {LLM_PROVIDERS.map((provider) => (
                <optgroup key={provider} label={PROVIDER_NAMES[provider]}>
                  {catalog.models
                    .filter((m) => m.provider === provider)
                    .map((m) => (
                      <option key={m.id} value={`${m.provider}::${m.id}`} disabled={!m.available}>
                        {modelLabel(m.label, provider)}
                        {m.available ? '' : ` — ${t('requiresKey')}`}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <p id="llm-model-hint" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('modelHint')}
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-3"
              onClick={handleSaveModel}
              disabled={saveOp.isLoading}
              data-testid="llm-save-model"
            >
              {t('saveModel')}
            </Button>
          </div>

          <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('keysTitle')}
            </h3>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('keysDescription')}</p>
            <div className="space-y-4">
              {LLM_PROVIDERS.map((provider) => (
                <ProviderKeyRow
                  key={provider}
                  provider={provider}
                  hint={catalog.credentials.find((c) => c.provider === provider) ?? null}
                  shared={catalog.sharedProviders.includes(provider)}
                  onChanged={reload}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ProviderKeyRowProps {
  provider: LlmProvider;
  hint: LlmCredentialHint | null;
  /** Provider works without a personal key (deployment key present). */
  shared: boolean;
  onChanged(): void;
}

function ProviderKeyRow({ provider, hint, shared, onChanged }: ProviderKeyRowProps) {
  const t = useTranslations('settings.account.llm');
  const llmApi = useLlmApi();
  const { addToast } = useToast();
  const [keyInput, setKeyInput] = useState('');

  const saveOp = useAsyncOperation<LlmCredentialHint>({ scope: 'control' });
  // Returns a sentinel: run() resolves undefined on failure, so a void op
  // could not distinguish success from error.
  const deleteOp = useAsyncOperation<boolean>({ scope: 'control' });

  // Credential writes 401 only for stale sessions (FreshAuthGuard) — the
  // bearer token itself is refreshed by the auth context.
  const toastError = useCallback(
    (message: string | undefined, httpStatus: number | undefined) => {
      if (httpStatus === 401) addToast('error', t('reauthRequired'));
      else addToast('error', message || t('saveFailed'));
    },
    [addToast, t],
  );

  useEffect(() => {
    if (saveOp.error && saveOp.error.reason !== 'aborted') {
      toastError(saveOp.error.message, saveOp.error.httpStatus);
    }
  }, [saveOp.error, toastError]);

  useEffect(() => {
    if (deleteOp.error && deleteOp.error.reason !== 'aborted') {
      toastError(deleteOp.error.message, deleteOp.error.httpStatus);
    }
  }, [deleteOp.error, toastError]);

  const handleSave = () => {
    const value = keyInput.trim();
    if (!value) return;
    void saveOp
      .run((signal) => llmApi.setCredential(provider, value, signal))
      .then((saved) => {
        if (saved !== undefined) {
          setKeyInput('');
          addToast('success', t('keySaved'));
          onChanged();
        }
      });
  };

  const handleDelete = () => {
    void deleteOp
      .run(async (signal) => {
        await llmApi.deleteCredential(provider, signal);
        return true;
      })
      .then((deleted) => {
        if (deleted) {
          addToast('success', t('keyDeleted'));
          onChanged();
        }
      });
  };

  const inputId = `llm-key-input-${provider}`;
  return (
    <div data-testid={`llm-key-row-${provider}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {PROVIDER_NAMES[provider]}
        </label>
        <span
          className="text-xs text-gray-500 dark:text-gray-400"
          data-testid={`llm-key-status-${provider}`}
        >
          {hint ? t('keySet', { hint: hint.keyHint }) : shared ? t('sharedAvailable') : t('noKey')}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="flex gap-2"
      >
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={KEY_PLACEHOLDERS[provider]}
          aria-label={t('keyInputLabel', { provider: PROVIDER_NAMES[provider] })}
          data-testid={inputId}
          className={inputClass}
        />
        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={saveOp.isLoading || !keyInput.trim()}
          data-testid={`llm-save-key-${provider}`}
        >
          {hint ? t('replaceKey') : t('saveKey')}
        </Button>
        {hint && (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleDelete}
            disabled={deleteOp.isLoading}
            data-testid={`llm-delete-key-${provider}`}
          >
            {t('deleteKey')}
          </Button>
        )}
      </form>
    </div>
  );
}
