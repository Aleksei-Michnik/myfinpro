'use client';

// Phase 6 · Iteration 6.20 — plan sub-form rendered inside
// `<PaymentFormDialog>` when the selected type is a plan kind (INSTALLMENT /
// LOAN / MORTGAGE). Mirrors the 6.18.1 schedule sub-form conventions: state
// is owned + persisted by the parent dialog so type toggles preserve the
// in-progress draft (sticky form).
//
// The plan's principal is the payment's own amount and its kind is the
// selected type — neither is repeated here (single source of truth).

import { isPlanKind } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import type { PaymentType, PlanSpec } from '@/lib/payment/types';

export const PLAN_PAYMENTS_COUNT_MAX = 600;

const FREQUENCIES: PlanSpec['frequency'][] = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
];

/** Local form-state shape — numeric fields kept as strings while typing. */
export interface PlanSubFormState {
  /** Annual interest rate in PERCENT as typed ("5" = 5% = 0.05). */
  interestRatePctStr: string;
  paymentsCountStr: string;
  frequency: PlanSpec['frequency'];
  /** yyyy-mm-dd. */
  firstDueAt: string;
  /** 'auto' resolves to the kind default server-side. */
  method: 'auto' | 'equal' | 'french';
}

export interface PlanSubFormErrors {
  interestRate?: string;
  paymentsCount?: string;
  firstDueAt?: string;
  method?: string;
}

export function defaultPlanSubFormState(): PlanSubFormState {
  return {
    interestRatePctStr: '0',
    paymentsCountStr: '12',
    frequency: 'MONTHLY',
    firstDueAt: new Date().toISOString().slice(0, 10),
    method: 'auto',
  };
}

interface BuildResult {
  ok: boolean;
  spec: PlanSpec;
  errors: PlanSubFormErrors;
}

/**
 * Validate + build the wire-shape `PlanSpec` from current form state.
 * `type` must be a plan kind — used for the equal-method + rate cross-check
 * (INSTALLMENT defaults to 'equal', which requires a 0% rate).
 *
 * `tValidation` is the `payments.plan.form.validation` translation function;
 * tests stub it with the identity-key formatter.
 */
export function buildPlanSpec(
  state: PlanSubFormState,
  type: PaymentType,
  tValidation: (key: string) => string,
): BuildResult {
  const errors: PlanSubFormErrors = {};

  const ratePct = Number(state.interestRatePctStr);
  if (state.interestRatePctStr.trim() === '' || Number.isNaN(ratePct) || ratePct < 0) {
    errors.interestRate = tValidation('rateInvalid');
  } else if (ratePct > 100) {
    errors.interestRate = tValidation('rateTooHigh');
  }

  const count = Number(state.paymentsCountStr);
  if (!Number.isInteger(count) || count < 1) {
    errors.paymentsCount = tValidation('countInvalid');
  } else if (count > PLAN_PAYMENTS_COUNT_MAX) {
    errors.paymentsCount = tValidation('countTooHigh');
  }

  let firstDueAtIso = '';
  if (!state.firstDueAt) {
    errors.firstDueAt = tValidation('firstDueRequired');
  } else {
    const d = new Date(`${state.firstDueAt}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      errors.firstDueAt = tValidation('firstDueInvalid');
    } else {
      firstDueAtIso = d.toISOString();
    }
  }

  // Cross-check: the 'equal' method is zero-interest by definition. Applies
  // when picked explicitly OR via the INSTALLMENT default — but never
  // overrides a more specific rate error already reported above.
  const effectiveMethod =
    state.method === 'auto' ? (type === 'INSTALLMENT' ? 'equal' : 'french') : state.method;
  if (effectiveMethod === 'equal' && !errors.interestRate && ratePct !== 0) {
    errors.interestRate = tValidation('equalRequiresZeroRate');
  }

  const ok = Object.keys(errors).length === 0 && isPlanKind(type);
  const spec: PlanSpec = {
    interestRate: Number.isNaN(ratePct) ? 0 : ratePct / 100,
    paymentsCount: Number.isInteger(count) ? count : 0,
    frequency: state.frequency,
    firstDueAt: firstDueAtIso,
    ...(state.method !== 'auto' ? { amortizationMethod: state.method } : {}),
  };
  return { ok, spec, errors };
}

export interface PaymentPlanSubFormProps {
  state: PlanSubFormState;
  errors: PlanSubFormErrors;
  onChange(next: PlanSubFormState): void;
  disabled?: boolean;
}

const inputClass =
  'mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export function PaymentPlanSubForm({ state, errors, onChange, disabled }: PaymentPlanSubFormProps) {
  const t = useTranslations('payments.plan.form');

  const set = (patch: Partial<PlanSubFormState>) => onChange({ ...state, ...patch });

  return (
    <fieldset
      className="rounded-md border border-gray-200 p-3 dark:border-gray-700"
      data-testid="payment-plan-subform"
    >
      <legend className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
        {t('legend')}
      </legend>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Interest rate (% p.a.) */}
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span>{t('rateLabel')}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            value={state.interestRatePctStr}
            onChange={(e) => set({ interestRatePctStr: e.target.value })}
            disabled={disabled}
            data-testid="plan-rate"
            className={inputClass}
          />
          {errors.interestRate && (
            <span
              className="mt-1 text-xs text-red-600 dark:text-red-400"
              data-testid="plan-error-rate"
            >
              {errors.interestRate}
            </span>
          )}
        </label>

        {/* Payments count */}
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span>{t('countLabel')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={PLAN_PAYMENTS_COUNT_MAX}
            step={1}
            value={state.paymentsCountStr}
            onChange={(e) => set({ paymentsCountStr: e.target.value })}
            disabled={disabled}
            data-testid="plan-count"
            className={inputClass}
          />
          {errors.paymentsCount && (
            <span
              className="mt-1 text-xs text-red-600 dark:text-red-400"
              data-testid="plan-error-count"
            >
              {errors.paymentsCount}
            </span>
          )}
        </label>

        {/* Frequency */}
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span>{t('frequencyLabel')}</span>
          <select
            value={state.frequency}
            onChange={(e) => set({ frequency: e.target.value as PlanSpec['frequency'] })}
            disabled={disabled}
            data-testid="plan-frequency"
            className={inputClass}
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`frequency.${f}`)}
              </option>
            ))}
          </select>
        </label>

        {/* First due date */}
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span>{t('firstDueLabel')}</span>
          <input
            type="date"
            value={state.firstDueAt}
            onChange={(e) => set({ firstDueAt: e.target.value })}
            disabled={disabled}
            data-testid="plan-first-due"
            className={inputClass}
          />
          {errors.firstDueAt && (
            <span
              className="mt-1 text-xs text-red-600 dark:text-red-400"
              data-testid="plan-error-first-due"
            >
              {errors.firstDueAt}
            </span>
          )}
        </label>

        {/* Amortisation method */}
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400 sm:col-span-2">
          <span>{t('methodLabel')}</span>
          <select
            value={state.method}
            onChange={(e) => set({ method: e.target.value as PlanSubFormState['method'] })}
            disabled={disabled}
            data-testid="plan-method"
            className={inputClass}
          >
            <option value="auto">{t('method.auto')}</option>
            <option value="equal">{t('method.equal')}</option>
            <option value="french">{t('method.french')}</option>
          </select>
        </label>
      </div>

      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('principalHint')}</p>
    </fieldset>
  );
}
