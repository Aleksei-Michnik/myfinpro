'use client';

// Phase 20 · Iteration 20.3 — create + edit account dialog (UI spec §2).
// Shared shape with <BudgetFormDialog>: save runs through
// useAsyncOperation({ scope: 'control' }) with <ButtonSpinner>, disabled
// inputs and aria-busy on the form; transport failures surface via the
// inline banner with Retry; domain errors (ACCOUNT_INVALID_*) map to
// per-field errors. Composition only — Dialog, Input, Select,
// TransactionScopeSelector, AccountSelect, Button/ButtonSpinner/
// InlineErrorBanner (kit — no hand-rolled shell).

import {
  ACCOUNT_INSTITUTIONS,
  ACCOUNT_KINDS,
  ACCOUNT_LAST4_PATTERN,
  CURRENCY_CODES,
  INSTITUTION_META,
  type AccountInstitution,
  type AccountKind,
  type AttributionScope,
} from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountSelect } from './AccountSelect';
import { TransactionScopeSelector } from '@/components/transaction/TransactionScopeSelector';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { Dialog } from '@/components/ui/Dialog';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useAccounts } from '@/lib/account/account-context';
import type { AccountSummary, CreateAccountInput, UpdateAccountInput } from '@/lib/account/types';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import { parseAmountToCents } from '@/lib/money';
import { useAsyncOperation } from '@/lib/ui';

export interface AccountFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** Required in 'edit' mode. */
  account?: AccountSummary;
  defaults?: Partial<{ scope: AttributionScope; currency: string }>;
  onClose(): void;
  onSaved(account: AccountSummary): void;
}

interface FormState {
  name: string;
  kind: AccountKind;
  institution: string; // '' = none
  currency: string;
  scope: AttributionScope | null;
  last4: string;
  openingBalanceStr: string;
  /** `<input type="date">` value — `YYYY-MM-DD`. */
  openingBalanceAt: string;
  billingAccountId: string | null;
  billingDayStr: string;
  /** Edit mode only. */
  reportedBalanceStr: string;
  reportedBalanceAt: string;
}

interface ValidationErrors {
  name?: string;
  currency?: string;
  scope?: string;
  last4?: string;
  openingDate?: string;
  billingAccount?: string;
  billingDay?: string;
}

function scopeToken(s: AttributionScope): string {
  return s.scope === 'personal' ? 'personal' : `group:${s.groupId}`;
}

/** ISO timestamp → `YYYY-MM-DD` date-input value (UTC, dates carry no meaningful time). */
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` date-input value → ISO timestamp at UTC midnight. */
function dateInputToIso(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function accountScope(a: AccountSummary): AttributionScope {
  return a.scopeType === 'personal'
    ? { scope: 'personal' }
    : { scope: 'group', groupId: a.groupId! };
}

function accountToState(a: AccountSummary): FormState {
  return {
    name: a.name,
    kind: a.kind,
    institution: a.institution ?? '',
    currency: a.currency,
    scope: accountScope(a),
    last4: a.last4 ?? '',
    openingBalanceStr: (a.openingBalanceCents / 100).toFixed(2),
    openingBalanceAt: isoToDateInput(a.openingBalanceAt),
    billingAccountId: a.billingAccountId ?? null,
    billingDayStr: a.billingDay !== null && a.billingDay !== undefined ? String(a.billingDay) : '',
    reportedBalanceStr:
      a.reportedBalanceCents !== null && a.reportedBalanceCents !== undefined
        ? (a.reportedBalanceCents / 100).toFixed(2)
        : '',
    reportedBalanceAt: isoToDateInput(a.reportedBalanceAt),
  };
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

export function AccountFormDialog({
  open,
  mode,
  account,
  defaults,
  onClose,
  onSaved,
}: AccountFormDialogProps) {
  const t = useTranslations('accounts.form');
  const tValidation = useTranslations('accounts.form.validation');
  const tKinds = useTranslations('accounts.kinds');
  const { user } = useAuth();
  const { groups } = useGroups();
  const { createAccount, updateAccount } = useAccounts();

  const scopeDefaultCurrency = (scope: AttributionScope | null): string => {
    if (scope?.scope === 'group') {
      const g = groups.find((x) => x.id === scope.groupId);
      if (g?.defaultCurrency) return g.defaultCurrency;
    }
    return user?.defaultCurrency ?? 'USD';
  };

  const initialState = useMemo<FormState>(() => {
    if (mode === 'edit' && account) return accountToState(account);
    const scope = defaults?.scope ?? { scope: 'personal' };
    return {
      name: '',
      kind: 'BANK',
      institution: '',
      currency: defaults?.currency ?? scopeDefaultCurrency(scope),
      scope,
      last4: '',
      openingBalanceStr: '',
      openingBalanceAt: '',
      billingAccountId: null,
      billingDayStr: '',
      reportedBalanceStr: '',
      reportedBalanceAt: '',
    };
    // groups/user only seed defaults; re-deriving on their churn would
    // clobber the user's draft.
  }, [mode, account?.id]);

  const [state, setState] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialStateRef = useRef(initialState);
  const currencyTouchedRef = useRef(defaults?.currency !== undefined);

  const saveOp = useAsyncOperation<AccountSummary>({ scope: 'control' });
  const isLoading = saveOp.isLoading;

  useEffect(() => {
    if (open) {
      setState(initialState);
      initialStateRef.current = initialState;
      currencyTouchedRef.current = defaults?.currency !== undefined;
      setErrors({});
      setConfirmDiscard(false);
      saveOp.reset();
    } else {
      saveOp.cancel();
    }
    // saveOp identity is stable; including it would re-fire on unrelated churn.
  }, [open, initialState]);

  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open && nameRef.current) nameRef.current.focus();
  }, [open]);

  const scopeLocked = mode === 'edit';
  const currencyLocked = mode === 'edit';
  // The API's UpdateAccountDto carries no `kind` field — the account's
  // physical kind is immutable after creation, same as scope/currency.
  const kindLocked = mode === 'edit';

  function handleScopeChange(next: AttributionScope[]) {
    const current = state.scope;
    const added = current
      ? next.find((s) => scopeToken(s) !== scopeToken(current))
      : next[next.length - 1];
    const scope = added ?? (next.length > 0 ? current : null);
    setState((s) => ({
      ...s,
      scope,
      currency: currencyTouchedRef.current ? s.currency : scopeDefaultCurrency(scope),
      billingAccountId: null,
    }));
  }

  const institutionOptions = useMemo(
    () => ACCOUNT_INSTITUTIONS.filter((i) => INSTITUTION_META[i].kinds.includes(state.kind)),
    [state.kind],
  );

  function handleKindChange(kind: AccountKind) {
    setState((s) => ({
      ...s,
      kind,
      institution: institutionOptions.some((i) => i === s.institution) ? s.institution : '',
      // Billing fields are CARD-only.
      billingAccountId: kind === 'CARD' ? s.billingAccountId : null,
      billingDayStr: kind === 'CARD' ? s.billingDayStr : '',
    }));
  }

  function validate(s: FormState): {
    ok: boolean;
    openingBalanceCents: number;
    reportedBalanceCents: number | null;
    billingDay: number | null;
    errors: ValidationErrors;
  } {
    const next: ValidationErrors = {};

    const trimmedName = s.name.trim();
    if (trimmedName.length === 0) next.name = tValidation('nameRequired');
    else if (trimmedName.length > 100) next.name = tValidation('nameTooLong');

    if (mode === 'create') {
      if (
        !/^[A-Z]{3}$/.test(s.currency) ||
        !(CURRENCY_CODES as readonly string[]).includes(s.currency)
      ) {
        next.currency = tValidation('currencyInvalid');
      }
      if (!s.scope) next.scope = tValidation('scopeRequired');
    }

    if (s.last4.trim().length > 0 && !ACCOUNT_LAST4_PATTERN.test(s.last4.trim())) {
      next.last4 = tValidation('last4Invalid');
    }

    const openingBalanceCents = s.openingBalanceStr.trim()
      ? (parseAmountToCents(s.openingBalanceStr) ?? 0)
      : 0;
    if (s.openingBalanceStr.trim() && !s.openingBalanceAt) {
      next.openingDate = tValidation('openingDateRequired');
    }

    let billingDay: number | null = null;
    if (s.kind === 'CARD' && s.billingDayStr.trim()) {
      const n = Number(s.billingDayStr);
      if (!Number.isInteger(n) || n < 1 || n > 28) {
        next.billingDay = tValidation('billingDayInvalid');
      } else {
        billingDay = n;
      }
    }
    if (s.kind === 'CARD' && billingDay !== null && !s.billingAccountId) {
      next.billingAccount = tValidation('billingAccountRequired');
    }

    const reportedBalanceCents = s.reportedBalanceStr.trim()
      ? (parseAmountToCents(s.reportedBalanceStr) ?? null)
      : null;

    return {
      ok: Object.keys(next).length === 0,
      openingBalanceCents,
      reportedBalanceCents,
      billingDay,
      errors: next,
    };
  }

  function applyDomainError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as Error & { errorCode?: string }).errorCode;
    if (!code) return false;
    if (code === 'ACCOUNT_INVALID_SCOPE') {
      setErrors((prev) => ({ ...prev, scope: extractMessage(err) }));
      return true;
    }
    if (code === 'ACCOUNT_CURRENCY_MISMATCH') {
      setErrors((prev) => ({ ...prev, currency: extractMessage(err) }));
      return true;
    }
    if (code === 'ACCOUNT_INVALID_BILLING') {
      setErrors((prev) => ({ ...prev, billingAccount: extractMessage(err) }));
      return true;
    }
    return false;
  }

  function runSave() {
    const {
      ok,
      openingBalanceCents,
      reportedBalanceCents,
      billingDay,
      errors: valErrors,
    } = validate(state);
    setErrors(valErrors);
    if (!ok) return;

    void saveOp
      .run(async (signal) => {
        try {
          if (mode === 'create') {
            const scope = state.scope!;
            const payload: CreateAccountInput = {
              name: state.name.trim(),
              kind: state.kind,
              institution: state.institution || undefined,
              currency: state.currency,
              scopeType: scope.scope,
              ...(scope.scope === 'group' ? { groupId: scope.groupId } : {}),
              last4: state.last4.trim() || undefined,
              openingBalanceCents,
              ...(state.openingBalanceAt
                ? { openingBalanceAt: dateInputToIso(state.openingBalanceAt) }
                : {}),
              ...(state.kind === 'CARD' && state.billingAccountId
                ? { billingAccountId: state.billingAccountId, billingDay: billingDay ?? undefined }
                : {}),
            };
            return await createAccount(payload, signal);
          }
          const diff: UpdateAccountInput = {};
          const trimmedName = state.name.trim();
          if (trimmedName !== account!.name) diff.name = trimmedName;
          const institutionValue = state.institution || null;
          if (institutionValue !== (account!.institution ?? null))
            diff.institution = institutionValue;
          const last4Value = state.last4.trim() || null;
          if (last4Value !== (account!.last4 ?? null)) diff.last4 = last4Value;
          if (openingBalanceCents !== account!.openingBalanceCents) {
            diff.openingBalanceCents = openingBalanceCents;
          }
          if (state.openingBalanceAt) {
            const iso = dateInputToIso(state.openingBalanceAt);
            if (new Date(iso).getTime() !== new Date(account!.openingBalanceAt).getTime()) {
              diff.openingBalanceAt = iso;
            }
          }
          if (reportedBalanceCents !== (account!.reportedBalanceCents ?? null)) {
            diff.reportedBalanceCents = reportedBalanceCents;
          }
          const reportedAtIso = state.reportedBalanceAt
            ? dateInputToIso(state.reportedBalanceAt)
            : null;
          const originalReportedAt = account!.reportedBalanceAt ?? null;
          if (
            (reportedAtIso === null) !== (originalReportedAt === null) ||
            (reportedAtIso !== null &&
              originalReportedAt !== null &&
              new Date(reportedAtIso).getTime() !== new Date(originalReportedAt).getTime())
          ) {
            diff.reportedBalanceAt = reportedAtIso;
          }
          const billingAccountValue = state.kind === 'CARD' ? state.billingAccountId : null;
          if (billingAccountValue !== (account!.billingAccountId ?? null)) {
            diff.billingAccountId = billingAccountValue;
          }
          const billingDayValue = state.kind === 'CARD' ? billingDay : null;
          if (billingDayValue !== (account!.billingDay ?? null)) {
            diff.billingDay = billingDayValue;
          }
          if (Object.keys(diff).length === 0) return account!;
          return await updateAccount(account!.id, diff, signal);
        } catch (e) {
          if (applyDomainError(e)) {
            throw new DOMException('domain', 'AbortError');
          }
          throw e;
        }
      })
      .then((result) => {
        if (result === undefined) return;
        onSaved(result);
        onClose();
      });
  }

  function handleCancel() {
    saveOp.cancel();
    if (isDirty()) setConfirmDiscard(true);
    else onClose();
  }

  function isDirty(): boolean {
    return JSON.stringify(initialStateRef.current) !== JSON.stringify(state);
  }

  if (!open) return null;

  const requestClose = () => {
    if (isDirty()) setConfirmDiscard(true);
    else handleCancel();
  };

  const sortedCurrencies = [
    state.currency,
    ...[...CURRENCY_CODES].filter((c) => c !== state.currency).sort(),
  ];

  const showBanner = saveOp.isError && saveOp.error !== null && saveOp.error.reason !== 'aborted';
  const allInputsDisabled = isLoading;
  const isCard = state.kind === 'CARD';

  return (
    <Dialog
      open
      onClose={requestClose}
      title={mode === 'create' ? t('createTitle') : t('editTitle')}
      testId="account-form-dialog"
      closeTestId="account-form-close"
      size="md"
    >
      <form
        noValidate
        aria-busy={isLoading || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          runSave();
        }}
      >
        <div className="mb-3">
          <Input
            ref={nameRef}
            id="account-form-name"
            label={t('name')}
            value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            maxLength={100}
            disabled={allInputsDisabled}
            data-testid="account-form-name"
            error={errors.name}
            size="sm"
          />
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={t('kind')}
            value={state.kind}
            onChange={(e) => handleKindChange(e.target.value as AccountKind)}
            disabled={allInputsDisabled || kindLocked}
            data-testid="account-form-kind"
            size="sm"
          >
            {ACCOUNT_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKinds(k)}
              </option>
            ))}
          </Select>

          <Select
            label={t('institution')}
            value={state.institution}
            onChange={(e) => setState((s) => ({ ...s, institution: e.target.value }))}
            disabled={allInputsDisabled}
            data-testid="account-form-institution"
            size="sm"
          >
            <option value="">{t('institutionNone')}</option>
            {institutionOptions.map((i: AccountInstitution) => (
              <option key={i} value={i}>
                {INSTITUTION_META[i].name}
              </option>
            ))}
          </Select>
        </div>

        <div className="mb-3">
          {currencyLocked ? (
            <div>
              <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('currency')}
              </span>
              <p
                className="mt-1 text-sm text-gray-900 dark:text-gray-100"
                data-testid="account-form-currency-locked"
              >
                {state.currency}
              </p>
              <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400">
                {t('currencyImmutable')}
              </p>
            </div>
          ) : (
            <Select
              label={t('currency')}
              value={state.currency}
              onChange={(e) => {
                currencyTouchedRef.current = true;
                setState((s) => ({ ...s, currency: e.target.value }));
              }}
              disabled={allInputsDisabled}
              data-testid="account-form-currency"
              error={errors.currency}
              size="sm"
            >
              {sortedCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('scope')}
          </div>
          <TransactionScopeSelector
            value={state.scope ? [state.scope] : []}
            onChange={handleScopeChange}
            disabled={allInputsDisabled || scopeLocked}
          />
          {scopeLocked && (
            <p
              className="mt-1 text-xs italic text-gray-500 dark:text-gray-400"
              data-testid="account-form-scope-locked"
            >
              {t('scopeImmutable')}
            </p>
          )}
          {errors.scope && (
            <span className="mt-1 text-xs text-red-600" data-testid="account-form-error-scope">
              {errors.scope}
            </span>
          )}
        </div>

        <div className="mb-3">
          <Input
            id="account-form-last4"
            label={t('last4')}
            inputMode="numeric"
            value={state.last4}
            onChange={(e) => setState((s) => ({ ...s, last4: e.target.value }))}
            disabled={allInputsDisabled}
            data-testid="account-form-last4"
            error={errors.last4}
            size="sm"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('last4Hint')}</p>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            id="account-form-opening-amount"
            label={t('openingBalance')}
            inputMode="decimal"
            value={state.openingBalanceStr}
            onChange={(e) => setState((s) => ({ ...s, openingBalanceStr: e.target.value }))}
            disabled={allInputsDisabled}
            data-testid="account-form-opening-amount"
            size="sm"
          />
          <Input
            id="account-form-opening-date"
            type="date"
            label={t('openingBalanceAt')}
            value={state.openingBalanceAt}
            onChange={(e) => setState((s) => ({ ...s, openingBalanceAt: e.target.value }))}
            disabled={allInputsDisabled}
            data-testid="account-form-opening-date"
            error={errors.openingDate}
            size="sm"
          />
        </div>
        <p className="-mt-2 mb-3 text-xs text-gray-500 dark:text-gray-400">{t('openingHint')}</p>

        {isCard && (
          <div
            className="mb-3 rounded-md border border-gray-200 p-3 dark:border-gray-700"
            data-testid="account-form-billing-section"
          >
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('billingAccount')}
            </div>
            <AccountSelect
              value={state.billingAccountId}
              onChange={(id) => setState((s) => ({ ...s, billingAccountId: id }))}
              kinds={['BANK']}
              currency={state.currency}
              scope={state.scope ?? undefined}
              disabled={allInputsDisabled}
              testId="account-form-billing-account"
              error={errors.billingAccount}
              emptyOptionLabel={t('institutionNone')}
            />
            <div className="mt-3">
              <Select
                label={t('billingDay')}
                value={state.billingDayStr}
                onChange={(e) => setState((s) => ({ ...s, billingDayStr: e.target.value }))}
                disabled={allInputsDisabled || !state.billingAccountId}
                data-testid="account-form-billing-day"
                error={errors.billingDay}
                size="sm"
              >
                <option value="">{t('institutionNone')}</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('billingHint')}</p>
            </div>
          </div>
        )}

        {mode === 'edit' && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="account-form-reported-amount"
              label={t('reportedBalance')}
              inputMode="decimal"
              value={state.reportedBalanceStr}
              onChange={(e) => setState((s) => ({ ...s, reportedBalanceStr: e.target.value }))}
              disabled={allInputsDisabled}
              data-testid="account-form-reported-amount"
              size="sm"
            />
            <Input
              id="account-form-reported-date"
              type="date"
              label={t('form.reportedBalanceAt') as never as string}
              value={state.reportedBalanceAt}
              onChange={(e) => setState((s) => ({ ...s, reportedBalanceAt: e.target.value }))}
              disabled={allInputsDisabled}
              data-testid="account-form-reported-date"
              size="sm"
            />
          </div>
        )}

        {showBanner && saveOp.error && (
          <div className="mb-3" data-testid="account-form-api-error">
            <InlineErrorBanner
              reason={saveOp.error.reason}
              httpStatus={saveOp.error.httpStatus}
              message={t('errorGeneric', { message: saveOp.error.message ?? '' })}
              onRetry={() => void saveOp.retry()}
              retrying={isLoading}
            />
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={handleCancel}
            data-testid="account-form-cancel"
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="flex-1"
            disabled={isLoading}
            aria-busy={isLoading}
            data-testid="account-form-save"
          >
            {isLoading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <ButtonSpinner />
                <span>{t('saving')}</span>
              </span>
            ) : (
              t('save')
            )}
          </Button>
        </div>
      </form>

      {confirmDiscard && (
        <div
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          role="alert"
          data-testid="account-form-discard-prompt"
        >
          <p className="mb-2">{t('discardChanges')}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDiscard(false)}
              data-testid="account-form-discard-keep"
            >
              {t('keepEditing')}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={onClose}
              data-testid="account-form-discard-confirm"
            >
              {t('discard')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
