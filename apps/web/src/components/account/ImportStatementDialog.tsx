'use client';

// Phase 20 · 20.5 — the statement import wizard (UI spec §1). Three steps:
// account + file → preview (detected format, sample, warnings, manual column
// mapping) → result. The file is decoded and parsed in the browser
// (`lib/statement/decode.ts` + the shared parser); only the normalised lines
// reach the API, in chunks of ACCOUNT_IMPORT_MAX_LINES (design §6.2).

import {
  parseStatementRows,
  type ManualColumnMapping,
  type ParsedStatement,
} from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type DragEvent } from 'react';
import { AccountSelect } from '@/components/account/AccountSelect';
import {
  StatementColumnMapper,
  isMappingComplete,
} from '@/components/account/StatementColumnMapper';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  FileCaptureButtons,
  type FileCaptureButtonsHandle,
} from '@/components/ui/FileCaptureButtons';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { Stat } from '@/components/ui/Stat';
import { Link } from '@/i18n/navigation';
import { useAccounts, type AccountApiError } from '@/lib/account/account-context';
import { drainSuggestions } from '@/lib/account/apply-suggestions';
import {
  ACCOUNT_IMPORT_MAX_LINES,
  type AccountImport,
  type AccountSummary,
} from '@/lib/account/types';
import { StatementDecodeError, decodeStatementFile, redactFileName } from '@/lib/statement/decode';
import { formatAmount, formatOccurredDate } from '@/lib/transaction/formatters';
import { useAsyncOperation } from '@/lib/ui';

export interface ImportStatementDialogProps {
  open: boolean;
  /** Pre-selected (and locked) account — from a card's menu or the detail page. */
  account?: AccountSummary | null;
  onClose(): void;
  /** Every import that landed (one per chunk); the host refreshes its data. */
  onImported(imports: AccountImport[]): void;
}

type Step = 1 | 2 | 3;

/** What the result step shows — the chunks' counters added up. */
export interface ImportTotals {
  inserted: number;
  duplicates: number;
  matches: number;
  transfers: number;
  needsInput: number;
}

export function sumImports(imports: AccountImport[]): ImportTotals {
  return imports.reduce<ImportTotals>(
    (acc, i) => ({
      inserted: acc.inserted + i.insertedCount,
      duplicates: acc.duplicates + i.duplicateCount,
      matches: acc.matches + i.suggestedMatchCount,
      transfers: acc.transfers + i.suggestedTransferCount,
      needsInput: acc.needsInput + i.needsInputCount,
    }),
    { inserted: 0, duplicates: 0, matches: 0, transfers: 0, needsInput: 0 },
  );
}

/** The first row with at least three filled cells — where a bank puts its header. */
export function guessHeaderRow(rows: string[][]): number {
  const idx = rows.findIndex((r) => r.filter((c) => c !== '').length >= 3);
  return idx === -1 ? 0 : idx;
}

const SAMPLE_ROWS = 5;

export function ImportStatementDialog({
  open,
  account: lockedAccount,
  onClose,
  onImported,
}: ImportStatementDialogProps) {
  const t = useTranslations('accounts.import');
  const locale = useLocale();
  const { createImport, applySuggestions, getAccount } = useAccounts();

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<string | null>(lockedAccount?.id ?? null);
  const [account, setAccount] = useState<AccountSummary | null>(lockedAccount ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [mapping, setMapping] = useState<ManualColumnMapping['columns'] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [imports, setImports] = useState<AccountImport[]>([]);
  const [applied, setApplied] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const captureRef = useRef<FileCaptureButtonsHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const parseOp = useAsyncOperation<ParsedStatement>({ scope: 'control', id: 'statement-parse' });
  const submitOp = useAsyncOperation<AccountImport[]>({
    scope: 'control',
    id: 'statement-import-submit',
  });
  const applyOp = useAsyncOperation<number>({
    scope: 'control',
    id: 'statement-apply-suggestions',
  });
  const accountOp = useAsyncOperation<AccountSummary>({
    scope: 'control',
    id: 'statement-import-account',
  });

  // Reset on every open so a second import starts clean. Keyed on the account
  // id, not the object: the host refetches the account after an import, and a
  // fresh object must not throw the wizard back to step 1.
  const lockedRef = useRef(lockedAccount);
  lockedRef.current = lockedAccount;
  const lockedId = lockedAccount?.id ?? null;
  useEffect(() => {
    if (!open) return;
    const lockedAccount = lockedRef.current;
    setStep(1);
    setAccountId(lockedAccount?.id ?? null);
    setAccount(lockedAccount ?? null);
    setFile(null);
    setRows(null);
    setParsed(null);
    setMapping(null);
    setFileError(null);
    setSubmitError(null);
    setImports([]);
    setApplied(null);
  }, [open, lockedId]);

  // A step change moves focus to its heading (spec §9).
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // The picker only yields an id; the currency and the review link need the row.
  useEffect(() => {
    if (!accountId || account?.id === accountId) return;
    void accountOp
      .run((signal) => getAccount(accountId, signal))
      .then((a) => {
        if (a) setAccount(a);
      });
    // accountOp / getAccount identities are stable.
  }, [accountId]);

  const busy = parseOp.isLoading || submitOp.isLoading || applyOp.isLoading;

  // ── Step 1 → 2: decode + parse ───────────────────────────────────────────
  const acceptFile = (candidate: File | undefined) => {
    setFileError(null);
    setFile(candidate ?? null);
  };

  const runParse = (
    nextRows: string[][],
    nextMapping: ManualColumnMapping['columns'] | null,
  ): Promise<ParsedStatement | undefined> =>
    parseOp.run(async () => {
      const options = nextMapping
        ? {
            mapping: { columns: nextMapping, headerRowIndex: guessHeaderRow(nextRows) },
            currency: account?.currency,
          }
        : { currency: account?.currency };
      const result = parseStatementRows(nextRows, options);
      setParsed(result);
      return result;
    });

  const handleContinue = async () => {
    if (!file || !accountId) return;
    setFileError(null);
    let decoded: string[][];
    try {
      decoded = (await decodeStatementFile(file)).rows;
    } catch (err) {
      const code = err instanceof StatementDecodeError ? err.code : 'unreadable';
      setFileError(t(`errors.${code}`));
      return;
    }
    setRows(decoded);
    const result = await runParse(decoded, null);
    if (!result) return;
    // Unknown format → open the mapper with nothing mapped yet.
    setMapping(result.preset === null ? {} : null);
    setStep(2);
  };

  const handleRemap = (next: ManualColumnMapping['columns']) => {
    setMapping(next);
    if (rows && isMappingComplete(next)) void runParse(rows, next);
  };

  // ── Step 2 → 3: submit in chunks ─────────────────────────────────────────
  const handleSubmit = async () => {
    if (!parsed || !accountId || parsed.lines.length === 0) return;
    setSubmitError(null);
    const source = parsed.preset ?? 'generic_csv';
    const result = await submitOp.run(async (signal) => {
      const landed: AccountImport[] = [];
      for (let i = 0; i < parsed.lines.length; i += ACCOUNT_IMPORT_MAX_LINES) {
        const chunk = parsed.lines.slice(i, i + ACCOUNT_IMPORT_MAX_LINES);
        const last = i + ACCOUNT_IMPORT_MAX_LINES >= parsed.lines.length;
        try {
          landed.push(
            await createImport(
              accountId,
              {
                source,
                originalName: file ? redactFileName(file.name) : undefined,
                lines: chunk,
                // The statement balance belongs to the whole statement — sent once.
                ...(last
                  ? {
                      statementBalanceCents: parsed.statementBalanceCents,
                      statementBalanceAt: parsed.statementBalanceAt,
                    }
                  : {}),
                periodFrom: parsed.periodFrom,
                periodTo: parsed.periodTo,
              },
              signal,
            ),
          );
        } catch (err) {
          setSubmitError(describeSubmitError(err, i, t));
          if (landed.length === 0) throw err;
          // Earlier chunks landed: show them, keep the error visible.
          return landed;
        }
      }
      return landed;
    });
    if (!result) return;
    setImports(result);
    onImported(result);
    setStep(3);
  };

  const handleApply = async () => {
    if (!accountId) return;
    const count = await applyOp.run(async (signal) => {
      const t = await drainSuggestions(() => applySuggestions(accountId, undefined, signal));
      return t.matched + t.created + t.transferred;
    });
    if (count === undefined) return;
    setApplied(count);
    // Counters are now stale — refresh the host once more.
    onImported(imports);
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const totals = useMemo(() => sumImports(imports), [imports]);
  const headers = useMemo(() => (rows ? (rows[guessHeaderRow(rows)] ?? []) : []), [rows]);
  const lineCount = parsed?.lines.length ?? 0;
  const mappingBlocks = mapping !== null && !isMappingComplete(mapping);
  const canSubmit = !busy && lineCount > 0 && !mappingBlocks;

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };
  const onZoneKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      captureRef.current?.openPicker();
    }
  };

  if (!open) return null;

  const stepIndicator = (
    <ol
      className="mb-3 flex gap-2 text-xs text-gray-500 dark:text-gray-400"
      aria-label={t('title')}
    >
      {([1, 2, 3] as const).map((n) => (
        <li
          key={n}
          aria-current={n === step ? 'step' : undefined}
          className={
            n === step
              ? 'rounded-full bg-primary-100 px-2 py-0.5 font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
              : 'px-2 py-0.5'
          }
          data-testid={`statement-import-step-${n}`}
        >
          {t('step', { current: n, total: 3 })}
        </li>
      ))}
    </ol>
  );

  const footer =
    step === 1 ? (
      <>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
          {t('back')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy || !file || !accountId}
          onClick={() => void handleContinue()}
          data-testid="statement-import-continue"
        >
          {parseOp.isLoading && <ButtonSpinner />}
          {t('continue')}
        </Button>
      </>
    ) : step === 2 ? (
      <>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setStep(1)}
          disabled={busy}
          data-testid="statement-import-back"
        >
          {t('back')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          data-testid="statement-import-submit"
        >
          {submitOp.isLoading && <ButtonSpinner />}
          {submitOp.isLoading ? t('submitting') : t('submit', { count: lineCount })}
        </Button>
      </>
    ) : (
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={onClose}
        data-testid="statement-import-done"
      >
        {t('done')}
      </Button>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      size="lg"
      busy={busy}
      testId="statement-import-dialog"
      closeTestId="statement-import-close"
      footer={<div className="flex justify-end gap-2">{footer}</div>}
    >
      {stepIndicator}
      <h3 ref={headingRef} tabIndex={-1} className="sr-only">
        {t('step', { current: step, total: 3 })}
      </h3>

      {step === 1 && (
        <div className="space-y-4">
          <AccountSelect
            label={t('account')}
            value={accountId}
            onChange={setAccountId}
            disabled={!!lockedAccount || busy}
            includeArchived={false}
            testId="statement-import-account"
          />
          <div
            role="button"
            tabIndex={0}
            aria-label={t('drop')}
            aria-describedby="statement-import-formats"
            onClick={() => captureRef.current?.openPicker()}
            onKeyDown={onZoneKey}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
              dragOver
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-300 dark:border-gray-600'
            }`}
            data-testid="statement-dropzone"
          >
            <span className="font-medium text-gray-900 dark:text-gray-100">{t('drop')}</span>
            <span
              id="statement-import-formats"
              className="text-xs text-gray-500 dark:text-gray-400"
            >
              {t('formats')}
            </span>
            <div onClick={(e) => e.stopPropagation()}>
              <FileCaptureButtons
                ref={captureRef}
                accept=".csv,.xlsx,.xls"
                onFiles={(files) => acceptFile(files[0])}
                browseLabel={t('browse')}
                cameraLabel={t('camera')}
                camera={false}
                testIdPrefix="statement"
                disabled={busy}
              />
            </div>
            {file && (
              <span
                dir="ltr"
                className="text-xs text-gray-700 dark:text-gray-300"
                data-testid="statement-file-name"
              >
                {file.name}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('privacy')}</p>
          {fileError && (
            <InlineErrorBanner
              reason="unknown"
              message={fileError}
              data-testid="statement-import-error"
            />
          )}
        </div>
      )}

      {step === 2 && parsed && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {parsed.preset && parsed.preset !== 'manual' && parsed.preset !== 'generic_csv' ? (
              <Badge tone="success" data-testid="statement-import-preset">
                {t('preset', { name: t(`sources.${parsed.preset}`) })}
              </Badge>
            ) : parsed.preset ? (
              <Badge tone="neutral" data-testid="statement-import-preset">
                {t('preset', { name: t(`sources.${parsed.preset}`) })}
              </Badge>
            ) : (
              <Badge tone="warning" data-testid="statement-import-preset">
                {t('presetUnknown')}
              </Badge>
            )}
            {mapping === null && (
              <button
                type="button"
                className="text-xs text-primary-700 underline dark:text-primary-300"
                onClick={() => setMapping({})}
                data-testid="statement-import-remap"
              >
                {t('remap')}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label={t('rows')}
              value={lineCount}
              size="sm"
              valueTestId="statement-import-rows"
            />
            {(parsed.periodFrom || parsed.periodTo) && (
              <Stat
                label={t('period')}
                size="sm"
                valueTestId="statement-import-period"
                value={
                  <span dir="ltr">
                    {[parsed.periodFrom, parsed.periodTo]
                      .filter(Boolean)
                      .map((d) => formatOccurredDate(d as string, locale))
                      .join(' – ')}
                  </span>
                }
              />
            )}
            {typeof parsed.statementBalanceCents === 'number' && account && (
              <Stat
                label={t('balance')}
                size="sm"
                valueTestId="statement-import-balance"
                value={
                  <span dir="ltr">
                    {formatAmount(parsed.statementBalanceCents, account.currency, locale)}
                  </span>
                }
              />
            )}
          </div>

          {mapping !== null && (
            <StatementColumnMapper
              headers={headers}
              value={mapping}
              onChange={handleRemap}
              disabled={busy}
            />
          )}

          {lineCount === 0 ? (
            <InlineErrorBanner
              reason="unknown"
              message={t('errors.noRows')}
              data-testid="statement-import-error"
            />
          ) : (
            <Card padding="sm" muted>
              <p className="mb-1 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                {t('sample')}
              </p>
              <ul
                className="divide-y divide-gray-200 text-sm dark:divide-gray-700"
                data-testid="statement-import-sample"
              >
                {parsed.lines.slice(0, SAMPLE_ROWS).map((line, i) => (
                  <li key={i} className="flex items-center gap-3 py-1">
                    <span
                      dir="ltr"
                      className="w-24 shrink-0 text-xs text-gray-500 dark:text-gray-400"
                    >
                      {formatOccurredDate(line.postedAt, locale)}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={line.description}>
                      {line.description}
                    </span>
                    <span dir="ltr" className="font-mono text-xs">
                      {(line.direction === 'OUT' ? '-' : '+') +
                        formatAmount(line.amountCents, line.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {parsed.warnings.length > 0 && (
            <Card padding="sm" muted role="status" data-testid="statement-import-warnings">
              <p className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('warnings', { count: parsed.warnings.length })}
              </p>
              <ul className="space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {parsed.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>
                    {t('warningRow', { row: w.row + 1, code: t(`warningCodes.${w.code}`) })}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {submitError && (
            <InlineErrorBanner
              reason="unknown"
              message={submitError}
              data-testid="statement-import-error"
            />
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {totals.inserted === 0 ? (
            <EmptyState title={t('allDuplicates')} data-testid="statement-result-empty" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat
                label={t('result.inserted')}
                value={totals.inserted}
                size="sm"
                valueTestId="statement-result-inserted"
              />
              <Stat
                label={t('result.duplicates')}
                value={totals.duplicates}
                size="sm"
                tone="muted"
                valueTestId="statement-result-duplicates"
              />
              <Stat
                label={t('result.matches')}
                value={totals.matches}
                size="sm"
                valueTestId="statement-result-matches"
              />
              <Stat
                label={t('result.transfers')}
                value={totals.transfers}
                size="sm"
                valueTestId="statement-result-transfers"
              />
              <Stat
                label={t('result.needsInput')}
                value={totals.needsInput}
                size="sm"
                valueTestId="statement-result-needsInput"
              />
            </div>
          )}
          {submitError && (
            <InlineErrorBanner
              reason="unknown"
              message={submitError}
              data-testid="statement-import-error"
            />
          )}
          {applied !== null && (
            <p
              className="text-sm text-green-700 dark:text-green-300"
              role="status"
              data-testid="statement-import-applied"
            >
              {t('applied', { count: applied })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {accountId && totals.inserted > 0 && (
              <Link
                href={`/accounts/${accountId}?tab=review`}
                onClick={onClose}
                className="inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                data-testid="statement-import-review-cta"
              >
                {t('reviewCta', { count: totals.inserted })}
              </Link>
            )}
            {applied === null && totals.matches + totals.transfers > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void handleApply()}
                data-testid="statement-import-apply-cta"
              >
                {applyOp.isLoading && <ButtonSpinner />}
                {t('applyCta', { count: totals.matches + totals.transfers })}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function describeSubmitError(
  err: unknown,
  chunkStart: number,
  t: ReturnType<typeof useTranslations<'accounts.import'>>,
): string {
  const code = (err as AccountApiError)?.errorCode;
  switch (code) {
    case 'ACCOUNT_IMPORT_TOO_LARGE':
      return t('errors.tooLarge');
    case 'ACCOUNT_IMPORT_INVALID_LINE': {
      const m = /(\d+)/.exec((err as Error).message ?? '');
      return t('errors.invalidLine', { index: chunkStart + (m ? Number(m[1]) : 0) + 1 });
    }
    case 'ACCOUNT_CURRENCY_MISMATCH':
      return t('errors.currency');
    case 'ACCOUNT_ARCHIVED':
      return t('errors.archived');
    default:
      return t('errors.generic');
  }
}
