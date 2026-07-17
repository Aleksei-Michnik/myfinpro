'use client';

// Phase 10 · Iteration 10.3 — create + edit budget dialog (design §7).
// Shared form DRY like <TransactionFormDialog>: save runs through
// useAsyncOperation({ scope: 'control' }) with <ButtonSpinner>, disabled
// inputs and aria-busy on the form; network/HTTP failures surface via the
// inline banner with Retry; domain errors (BUDGET_INVALID_*) map to
// per-field errors. Client-side validation mirrors the CreateBudgetDto /
// UpdateBudgetDto rules (design §5 "Validation rules").

import { BUDGET_PERIODS, CURRENCY_CODES, type AttributionScope } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TransactionCategoryPicker } from '@/components/transaction/TransactionCategoryPicker';
import { TransactionScopeSelector } from '@/components/transaction/TransactionScopeSelector';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useAuth } from '@/lib/auth/auth-context';
import { useBudgets } from '@/lib/budget/budget-context';
import { getLastUsedBudgetScope, setLastUsedBudgetScope } from '@/lib/budget/remember';
import type {
  BudgetPeriod,
  BudgetSummary,
  CreateBudgetInput,
  UpdateBudgetInput,
} from '@/lib/budget/types';
import { isoToLocalInput, localInputToIso } from '@/lib/datetime';
import { useGroups } from '@/lib/group/group-context';
import { parseAmountToCents } from '@/lib/money';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { CategoryDto } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface BudgetFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** Required in 'edit' mode. */
  budget?: BudgetSummary;
  defaults?: Partial<{
    scope: AttributionScope;
    currency: string;
    categoryId: string;
  }>;
  onClose(): void;
  onSaved(budget: BudgetSummary): void;
  /** Optional shared categories list (tests / hosts that already fetched). */
  categories?: CategoryDto[] | null;
}

interface FormState {
  name: string;
  amountStr: string; // raw string so we can validate empty / negative.
  currency: string;
  /** Exactly one scope (design §2.1) — null only when the user unchecks it. */
  scope: AttributionScope | null;
  categoryId: string | null; // null = all spending
  period: BudgetPeriod;
  /** `<input type="date">` values — `YYYY-MM-DD` (CUSTOM only). */
  startsAt: string;
  endsAt: string;
  alertThresholdStr: string; // raw string; '' = threshold alert disabled.
  alertOverspend: boolean;
}

interface ValidationErrors {
  name?: string;
  amount?: string;
  currency?: string;
  scope?: string;
  category?: string;
  period?: string;
  startsAt?: string;
  endsAt?: string;
  threshold?: string;
}

function scopeToken(s: AttributionScope): string {
  return s.scope === 'personal' ? 'personal' : `group:${s.groupId}`;
}

/**
 * Whether a category is usable by a budget in `scope` — system categories
 * are visible everywhere, personal/group ones only in their own scope
 * (mirrors the API's validateCategoryForScope).
 */
function categoryVisibleInScope(c: CategoryDto, scope: AttributionScope | null): boolean {
  if (c.ownerType === 'system') return true;
  if (c.ownerType === 'user') return scope?.scope === 'personal';
  return scope?.scope === 'group' && c.ownerId === scope.groupId;
}

function budgetScope(b: BudgetSummary): AttributionScope {
  return b.scopeType === 'personal'
    ? { scope: 'personal' }
    : { scope: 'group', groupId: b.groupId! };
}

/** ISO timestamp → `YYYY-MM-DD` date-input value (local zone). */
function isoToDateInput(iso: string | null): string {
  return iso ? isoToLocalInput(iso).slice(0, 10) : '';
}

/** `YYYY-MM-DD` date-input value → ISO timestamp at local midnight. */
function dateInputToIso(date: string): string {
  return localInputToIso(`${date}T00:00`);
}

function budgetToState(b: BudgetSummary): FormState {
  return {
    name: b.name,
    amountStr: (b.amountCents / 100).toFixed(2),
    currency: b.currency,
    scope: budgetScope(b),
    categoryId: b.categoryId,
    period: b.period,
    startsAt: isoToDateInput(b.startsAt),
    endsAt: isoToDateInput(b.endsAt),
    alertThresholdStr: b.alertThresholdPct === null ? '' : String(b.alertThresholdPct),
    alertOverspend: b.alertOverspend,
  };
}

/** Build a minimal UpdateBudgetInput containing only the changed fields. */
export function computeBudgetDiff(
  original: BudgetSummary,
  draft: FormState,
  draftAmountCents: number,
  draftThreshold: number | null,
): UpdateBudgetInput {
  const diff: UpdateBudgetInput = {};

  const trimmedName = draft.name.trim();
  if (trimmedName !== original.name) diff.name = trimmedName;
  if (draftAmountCents !== original.amountCents) diff.amountCents = draftAmountCents;
  if (draft.currency !== original.currency) diff.currency = draft.currency;
  if (draft.categoryId !== original.categoryId) diff.categoryId = draft.categoryId;

  // Period + CUSTOM bounds. Switching away from CUSTOM auto-clears the
  // stale bounds server-side, so only `period` is sent; explicit bounds on
  // a repeating period would be rejected (BUDGET_INVALID_PERIOD).
  if (draft.period !== original.period) diff.period = draft.period;
  if (draft.period === 'CUSTOM') {
    const startsAtIso = draft.startsAt ? dateInputToIso(draft.startsAt) : null;
    const endsAtIso = draft.endsAt ? dateInputToIso(draft.endsAt) : null;
    // Compare instants — the date-input round-trip loses sub-day precision.
    const changed = (a: string | null, b: string | null) =>
      (a === null) !== (b === null) || (a !== null && b !== null && +new Date(a) !== +new Date(b));
    if (draft.period !== original.period || changed(startsAtIso, original.startsAt)) {
      diff.startsAt = startsAtIso;
    }
    if (draft.period !== original.period || changed(endsAtIso, original.endsAt)) {
      diff.endsAt = endsAtIso;
    }
  }

  if (draftThreshold !== original.alertThresholdPct) diff.alertThresholdPct = draftThreshold;
  if (draft.alertOverspend !== original.alertOverspend) diff.alertOverspend = draft.alertOverspend;

  return diff;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

export function BudgetFormDialog({
  open,
  mode,
  budget,
  defaults,
  onClose,
  onSaved,
  categories: categoriesProp,
}: BudgetFormDialogProps) {
  const t = useTranslations('budgets.form');
  const tValidation = useTranslations('budgets.form.validation');
  const { user } = useAuth();
  const { groups } = useGroups();
  const { createBudget, updateBudget } = useBudgets();
  const { listCategories } = useTransactions();

  // The scope's default currency: the group's for a group budget, the
  // user's otherwise (mirrors the API's currency defaulting, design §2.4).
  const scopeDefaultCurrency = (scope: AttributionScope | null): string => {
    if (scope?.scope === 'group') {
      const g = groups.find((x) => x.id === scope.groupId);
      if (g?.defaultCurrency) return g.defaultCurrency;
    }
    return user?.defaultCurrency ?? 'USD';
  };

  // ── Build initial state ─────────────────────────────────────────────────

  const initialState = useMemo<FormState>(() => {
    if (mode === 'edit' && budget) return budgetToState(budget);
    const scope =
      defaults?.scope ??
      (typeof window !== 'undefined' ? getLastUsedBudgetScope() : { scope: 'personal' });
    return {
      name: '',
      amountStr: '',
      currency: defaults?.currency ?? scopeDefaultCurrency(scope),
      scope,
      categoryId: defaults?.categoryId ?? null,
      period: 'MONTHLY',
      startsAt: '',
      endsAt: '',
      alertThresholdStr: '',
      alertOverspend: true,
    };
    // groups/user only seed defaults; re-deriving on their churn would
    // clobber the user's draft.
  }, [mode, budget?.id]);

  const [state, setState] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialStateRef = useRef(initialState);
  // Whether the user picked a currency by hand — a manual pick stops the
  // currency from following the scope's default.
  const currencyTouchedRef = useRef(defaults?.currency !== undefined);

  // Save flow runs through the universal control-scope async hook.
  const saveOp = useAsyncOperation<BudgetSummary>({ scope: 'control' });
  const isLoading = saveOp.isLoading;

  // Categories: fetched once per open (all scopes, direction OUT) and
  // narrowed client-side to the chosen scope — system categories are
  // visible everywhere, personal/group ones only in their own scope.
  const categoriesOp = useAsyncOperation<CategoryDto[]>({ scope: 'container' });
  const useOwnCategories = categoriesProp === undefined || categoriesProp === null;
  useEffect(() => {
    if (!open || !useOwnCategories) return;
    void categoriesOp.run((signal) => listCategories({ direction: 'OUT' }, signal));
    // categoriesOp identity is stable (useAsyncOperation contract).
  }, [open, useOwnCategories, listCategories]);
  const allCategories = useOwnCategories ? (categoriesOp.data ?? null) : categoriesProp;

  const scopedCategories = useMemo<CategoryDto[] | null>(() => {
    if (!allCategories) return null;
    return allCategories.filter((c) => categoryVisibleInScope(c, state.scope));
  }, [allCategories, state.scope]);

  // Reset when reopened.
  useEffect(() => {
    if (open) {
      setState(initialState);
      initialStateRef.current = initialState;
      currencyTouchedRef.current = defaults?.currency !== undefined;
      setErrors({});
      setConfirmDiscard(false);
      saveOp.reset();
    } else {
      // Closed mid-flight → abort.
      saveOp.cancel();
      categoriesOp.cancel();
    }
    // saveOp/categoriesOp identities are stable; including them would
    // re-fire on unrelated churn.
  }, [open, initialState]);

  // Focus the name input on open.
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open && nameRef.current) nameRef.current.focus();
  }, [open]);

  // ── Scope handling — single-select over the multi-select selector ───────

  // Scope is immutable after creation (API design §5) — the selector is
  // rendered read-only in edit mode.
  const scopeLocked = mode === 'edit';

  function handleScopeChange(next: AttributionScope[]) {
    const current = state.scope;
    // The selector toggles checkboxes; treat the newly-checked entry as the
    // single selection. Unchecking the current one clears the scope (caught
    // by validation).
    const added = current
      ? next.find((s) => scopeToken(s) !== scopeToken(current))
      : next[next.length - 1];
    const scope = added ?? (next.length > 0 ? current : null);
    setState((s) => ({
      ...s,
      scope,
      // Currency follows the scope's default until the user picks one by hand.
      currency: currencyTouchedRef.current ? s.currency : scopeDefaultCurrency(scope),
      // Drop a category that is not visible in the new scope.
      categoryId:
        s.categoryId && allCategories
          ? (allCategories.find((c) => c.id === s.categoryId && categoryVisibleInScope(c, scope))
              ?.id ?? null)
          : s.categoryId,
    }));
  }

  // ── Validation (mirrors CreateBudgetDto / UpdateBudgetDto) ───────────────

  function validate(s: FormState): {
    ok: boolean;
    amountCents: number;
    threshold: number | null;
    errors: ValidationErrors;
  } {
    const next: ValidationErrors = {};

    const trimmedName = s.name.trim();
    if (trimmedName.length === 0) next.name = tValidation('nameRequired');
    else if (trimmedName.length > 100) next.name = tValidation('nameTooLong');

    const cents = parseAmountToCents(s.amountStr);
    if (cents === null || cents <= 0) next.amount = tValidation('amountRequired');

    if (
      !/^[A-Z]{3}$/.test(s.currency) ||
      !(CURRENCY_CODES as readonly string[]).includes(s.currency)
    ) {
      next.currency = tValidation('currencyInvalid');
    }

    if (!s.scope) next.scope = tValidation('scopeRequired');

    // The picker only offers OUT/BOTH categories for the chosen scope, so a
    // stale id (e.g. after a scope switch mid-load) is the only failure mode.
    if (s.categoryId && scopedCategories && !scopedCategories.some((c) => c.id === s.categoryId)) {
      next.category = tValidation('categoryInvalid');
    }

    if (s.period === 'CUSTOM') {
      if (!s.startsAt) next.startsAt = tValidation('customStartRequired');
      if (!s.endsAt) next.endsAt = tValidation('customEndRequired');
      if (s.startsAt && s.endsAt && s.startsAt >= s.endsAt) {
        next.endsAt = tValidation('customRangeInvalid');
      }
    }

    let threshold: number | null = null;
    const rawThreshold = s.alertThresholdStr.trim();
    if (rawThreshold.length > 0) {
      const n = Number(rawThreshold);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        next.threshold = tValidation('thresholdInvalid');
      } else {
        threshold = n;
      }
    }

    return {
      ok: Object.keys(next).length === 0,
      amountCents: cents ?? 0,
      threshold,
      errors: next,
    };
  }

  // ── Save handler ─────────────────────────────────────────────────────────

  // Domain-error code → per-field error mapping. Anything else falls through
  // to the inline banner driven by the async-operation hook.
  function applyDomainError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as Error & { errorCode?: string }).errorCode;
    if (!code) return false;
    if (code === 'BUDGET_INVALID_SCOPE') {
      setErrors((prev) => ({ ...prev, scope: extractMessage(err) }));
      return true;
    }
    if (code === 'BUDGET_INVALID_CATEGORY') {
      setErrors((prev) => ({ ...prev, category: extractMessage(err) }));
      return true;
    }
    if (code === 'BUDGET_INVALID_PERIOD') {
      setErrors((prev) => ({ ...prev, period: extractMessage(err) }));
      return true;
    }
    return false;
  }

  function runSave() {
    const { ok, amountCents, threshold, errors: valErrors } = validate(state);
    setErrors(valErrors);
    if (!ok) return;

    void saveOp
      .run(async (signal) => {
        try {
          if (mode === 'create') {
            const scope = state.scope!;
            const payload: CreateBudgetInput = {
              name: state.name.trim(),
              amountCents,
              currency: state.currency,
              scopeType: scope.scope,
              ...(scope.scope === 'group' ? { groupId: scope.groupId } : {}),
              ...(state.categoryId ? { categoryId: state.categoryId } : {}),
              period: state.period,
              ...(state.period === 'CUSTOM'
                ? {
                    startsAt: dateInputToIso(state.startsAt),
                    endsAt: dateInputToIso(state.endsAt),
                  }
                : {}),
              ...(threshold !== null ? { alertThresholdPct: threshold } : {}),
              alertOverspend: state.alertOverspend,
            };
            return await createBudget(payload, signal);
          }
          // Edit: PATCH only the changed fields.
          const diff = computeBudgetDiff(budget!, state, amountCents, threshold);
          if (Object.keys(diff).length === 0) return budget!;
          return await updateBudget(budget!.id, diff, signal);
        } catch (e) {
          if (applyDomainError(e)) {
            // Domain error — surfaced via per-field errors only. The abort
            // lands the hook back in idle, keeping the banner hidden (see
            // docs/ui-async-conventions.md).
            throw new DOMException('domain', 'AbortError');
          }
          throw e;
        }
      })
      .then((result) => {
        if (result === undefined) return; // error, abort, or domain-error
        if (mode === 'create' && state.scope) setLastUsedBudgetScope(state.scope);
        onSaved(result);
        onClose();
      });
  }

  function handleCancel() {
    saveOp.cancel();
    if (isDirty()) setConfirmDiscard(true);
    else onClose();
  }

  // ── Draft-change detection for ESC confirm ───────────────────────────────

  function isDirty(): boolean {
    return JSON.stringify(initialStateRef.current) !== JSON.stringify(state);
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isDirty()) setConfirmDiscard(true);
        else handleCancel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, state]);

  if (!open) return null;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (isDirty()) setConfirmDiscard(true);
      else handleCancel();
    }
  };

  // Build currency list: current selection first, rest alphabetical.
  const sortedCurrencies = [
    state.currency,
    ...[...CURRENCY_CODES].filter((c) => c !== state.currency).sort(),
  ];

  const showBanner = saveOp.isError && saveOp.error !== null && saveOp.error.reason !== 'aborted';
  const allInputsDisabled = isLoading;

  const inputClass =
    'mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-form-title"
      data-testid="budget-form-dialog"
      onMouseDown={handleBackdrop}
    >
      <div className="mx-4 max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3
            id="budget-form-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {mode === 'create' ? t('createTitle') : t('editTitle')}
          </h3>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label={t('close')}
            data-testid="budget-form-close"
          >
            ✕
          </button>
        </div>

        <form
          // Native constraint validation (the threshold's min/max) would
          // block submit with unlocalized browser bubbles — our validate()
          // owns the UX with translated, per-field messages instead.
          noValidate
          aria-busy={isLoading || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            runSave();
          }}
        >
          {/* Name */}
          <div className="mb-3">
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('name')}</span>
              <input
                ref={nameRef}
                type="text"
                value={state.name}
                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                placeholder={t('namePlaceholder')}
                maxLength={100}
                disabled={allInputsDisabled}
                data-testid="budget-form-name"
                aria-invalid={!!errors.name}
                className={inputClass}
              />
            </label>
            {errors.name && (
              <span className="mt-1 text-xs text-red-600" data-testid="budget-form-error-name">
                {errors.name}
              </span>
            )}
          </div>

          {/* Amount + Currency */}
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('amount')}</span>
              <input
                type="text"
                inputMode="decimal"
                value={state.amountStr}
                onChange={(e) => setState((s) => ({ ...s, amountStr: e.target.value }))}
                placeholder={t('amountPlaceholder')}
                disabled={allInputsDisabled}
                data-testid="budget-form-amount"
                aria-invalid={!!errors.amount}
                className={inputClass}
              />
              {errors.amount && (
                <span className="mt-1 text-xs text-red-600" data-testid="budget-form-error-amount">
                  {errors.amount}
                </span>
              )}
            </label>

            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('currency')}</span>
              <select
                value={state.currency}
                onChange={(e) => {
                  currencyTouchedRef.current = true;
                  setState((s) => ({ ...s, currency: e.target.value }));
                }}
                disabled={allInputsDisabled}
                data-testid="budget-form-currency"
                className={inputClass}
              >
                {sortedCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {errors.currency && (
                <span
                  className="mt-1 text-xs text-red-600"
                  data-testid="budget-form-error-currency"
                >
                  {errors.currency}
                </span>
              )}
            </label>
          </div>

          {/* Scope */}
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
                data-testid="budget-form-scope-locked"
              >
                {t('scopeImmutable')}
              </p>
            )}
            {errors.scope && (
              <span className="mt-1 text-xs text-red-600" data-testid="budget-form-error-scope">
                {errors.scope}
              </span>
            )}
          </div>

          {/* Category (optional) */}
          <div className="mb-3">
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('category')}</span>
              <div className="mt-1">
                <TransactionCategoryPicker
                  direction="OUT"
                  value={state.categoryId}
                  onChange={(id) => setState((s) => ({ ...s, categoryId: id || null }))}
                  categories={scopedCategories}
                  disabled={allInputsDisabled}
                  emptyOptionLabel={t('categoryAll')}
                  testId="budget-form-category-picker"
                />
              </div>
            </label>
            {errors.category && (
              <span className="mt-1 text-xs text-red-600" data-testid="budget-form-error-category">
                {errors.category}
              </span>
            )}
          </div>

          {/* Period */}
          <div className="mb-3">
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('period')}</span>
              <select
                value={state.period}
                onChange={(e) =>
                  setState((s) => ({ ...s, period: e.target.value as BudgetPeriod }))
                }
                disabled={allInputsDisabled}
                data-testid="budget-form-period"
                className={inputClass}
              >
                {BUDGET_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t(`periods.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            {errors.period && (
              <span className="mt-1 text-xs text-red-600" data-testid="budget-form-error-period">
                {errors.period}
              </span>
            )}
          </div>

          {/* Custom date range — disclosed only for CUSTOM (one-off targets). */}
          {state.period === 'CUSTOM' && (
            <div
              className="mb-3 rounded-md border border-gray-200 p-3 dark:border-gray-700"
              data-testid="budget-form-custom-range"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
                  <span>{t('customStart')}</span>
                  <input
                    type="date"
                    value={state.startsAt}
                    onChange={(e) => setState((s) => ({ ...s, startsAt: e.target.value }))}
                    disabled={allInputsDisabled}
                    data-testid="budget-form-starts-at"
                    aria-invalid={!!errors.startsAt}
                    className={inputClass}
                  />
                  {errors.startsAt && (
                    <span
                      className="mt-1 text-xs text-red-600"
                      data-testid="budget-form-error-starts-at"
                    >
                      {errors.startsAt}
                    </span>
                  )}
                </label>
                <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
                  <span>{t('customEnd')}</span>
                  <input
                    type="date"
                    value={state.endsAt}
                    onChange={(e) => setState((s) => ({ ...s, endsAt: e.target.value }))}
                    disabled={allInputsDisabled}
                    data-testid="budget-form-ends-at"
                    aria-invalid={!!errors.endsAt}
                    className={inputClass}
                  />
                  {errors.endsAt && (
                    <span
                      className="mt-1 text-xs text-red-600"
                      data-testid="budget-form-error-ends-at"
                    >
                      {errors.endsAt}
                    </span>
                  )}
                </label>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('customRangeHint')}
              </p>
            </div>
          )}

          {/* Alerts */}
          <div className="mb-4 rounded-md border border-gray-200 p-3 dark:border-gray-700">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
                <span>{t('alertThreshold')}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  value={state.alertThresholdStr}
                  onChange={(e) => setState((s) => ({ ...s, alertThresholdStr: e.target.value }))}
                  placeholder={t('alertThresholdPlaceholder')}
                  disabled={allInputsDisabled}
                  data-testid="budget-form-threshold"
                  aria-invalid={!!errors.threshold}
                  className={inputClass}
                />
                <span className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {t('alertThresholdHint')}
                </span>
                {errors.threshold && (
                  <span
                    className="mt-1 text-xs text-red-600"
                    data-testid="budget-form-error-threshold"
                  >
                    {errors.threshold}
                  </span>
                )}
              </label>
              <label className="flex items-start gap-2 pt-4 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={state.alertOverspend}
                  onChange={(e) => setState((s) => ({ ...s, alertOverspend: e.target.checked }))}
                  disabled={allInputsDisabled}
                  data-testid="budget-form-overspend"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span>{t('alertOverspend')}</span>
              </label>
            </div>
          </div>

          {showBanner && saveOp.error && (
            <div className="mb-3" data-testid="budget-form-api-error">
              <InlineErrorBanner
                reason={saveOp.error.reason}
                httpStatus={saveOp.error.httpStatus}
                message={t('errorGeneric', { message: saveOp.error.message ?? '' })}
                onRetry={() => void saveOp.retry()}
                retrying={isLoading}
                data-testid="budget-form-api-error-banner"
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
              data-testid="budget-form-cancel"
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
              data-testid="budget-form-save"
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
            data-testid="budget-form-discard-prompt"
          >
            <p className="mb-2">{t('discardChanges')}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDiscard(false)}
                data-testid="budget-form-discard-keep"
              >
                {t('keepEditing')}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={onClose}
                data-testid="budget-form-discard-confirm"
              >
                {t('discard')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
