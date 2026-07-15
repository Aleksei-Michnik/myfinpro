'use client';

// Phase 6 · Iteration 6.18.1 — schedule sub-form rendered inside
// `<TransactionFormDialog>` when `type === 'RECURRING'`.
//
// State shape is owned + persisted by the parent dialog so toggling between
// ONE_TIME and RECURRING preserves the in-progress draft (sticky form).

import { useTranslations } from 'next-intl';
import type { ScheduleSpec } from '@/lib/transaction/types';

export type ScheduleRepeatMode = 'every' | 'cron';
export type ScheduleEveryUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

const MS_PER_UNIT: Record<ScheduleEveryUnit, number> = {
  minute: 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 30 * 24 * 60 * 60_000,
};

export const SCHEDULE_EVERY_MS_FLOOR = 60_000;

/** Local form-state shape — kept verbose so toggles preserve every field. */
export interface ScheduleSubFormState {
  mode: ScheduleRepeatMode;
  /** Numeric input as string — preserves empty / partially-typed values. */
  everyCountStr: string;
  everyUnit: ScheduleEveryUnit;
  cron: string;
  /** yyyy-mm-dd. */
  startsAt: string;
  /** yyyy-mm-dd or empty. */
  endsAt: string;
  /** Numeric input as string; empty = unlimited. */
  limitStr: string;
}

export interface ScheduleSubFormErrors {
  every?: string;
  cron?: string;
  startsAt?: string;
  endsAt?: string;
  limit?: string;
  /** Cross-field — neither mode produced a usable spec. */
  spec?: string;
}

export function defaultScheduleSubFormState(): ScheduleSubFormState {
  return {
    mode: 'every',
    everyCountStr: '1',
    everyUnit: 'day',
    cron: '',
    startsAt: new Date().toISOString().slice(0, 10),
    endsAt: '',
    limitStr: '',
  };
}

/** Decode an existing schedule into form-state for the edit flow. */
export function scheduleResponseToFormState(s: {
  cron: string | null;
  everyMs: number | null;
  startsAt: string;
  endsAt: string | null;
  limit: number | null;
}): ScheduleSubFormState {
  const base = defaultScheduleSubFormState();
  const startsAt = s.startsAt.slice(0, 10) || base.startsAt;
  const endsAt = s.endsAt ? s.endsAt.slice(0, 10) : '';
  const limitStr = s.limit ? String(s.limit) : '';
  if (s.cron) {
    return { ...base, mode: 'cron', cron: s.cron, startsAt, endsAt, limitStr };
  }
  if (typeof s.everyMs === 'number' && s.everyMs > 0) {
    // Best-fit unit decomposition: prefer the largest unit that exactly divides.
    const units: ScheduleEveryUnit[] = ['month', 'week', 'day', 'hour', 'minute'];
    for (const u of units) {
      const ms = MS_PER_UNIT[u];
      if (s.everyMs % ms === 0) {
        return {
          ...base,
          mode: 'every',
          everyCountStr: String(s.everyMs / ms),
          everyUnit: u,
          startsAt,
          endsAt,
          limitStr,
        };
      }
    }
    return {
      ...base,
      mode: 'every',
      everyCountStr: String(Math.max(1, Math.round(s.everyMs / MS_PER_UNIT.minute))),
      everyUnit: 'minute',
      startsAt,
      endsAt,
      limitStr,
    };
  }
  return { ...base, startsAt, endsAt, limitStr };
}

interface BuildResult {
  ok: boolean;
  spec: ScheduleSpec;
  errors: ScheduleSubFormErrors;
}

/**
 * Validate + build the wire-shape `ScheduleSpec` from current form state.
 * Returns inline errors on failure; the parent dialog uses these to short-
 * circuit the save flow before any network call.
 *
 * `tValidation` is the `transactions.schedule.form.validation` translation
 * function; tests stub it with the identity-key formatter.
 */
export function buildScheduleSpec(
  state: ScheduleSubFormState,
  tValidation: (key: string, values?: Record<string, string | number>) => string,
): BuildResult {
  const errors: ScheduleSubFormErrors = {};
  const spec: ScheduleSpec = {};

  if (state.mode === 'every') {
    const count = Number(state.everyCountStr);
    if (
      !state.everyCountStr ||
      !/^\d+$/.test(state.everyCountStr) ||
      !Number.isFinite(count) ||
      count < 1
    ) {
      errors.every = tValidation('everyCountInvalid');
    } else {
      const everyMs = count * MS_PER_UNIT[state.everyUnit];
      if (everyMs < SCHEDULE_EVERY_MS_FLOOR) {
        errors.every = tValidation('everyMsTooSmall');
      } else {
        spec.everyMs = everyMs;
      }
    }
  } else {
    const cron = state.cron.trim();
    if (!cron) {
      errors.cron = tValidation('cronRequired');
    } else {
      spec.cron = cron;
    }
  }

  if (!state.startsAt) {
    errors.startsAt = tValidation('startsAtInvalid');
  } else {
    spec.startsAt = `${state.startsAt}T00:00:00Z`;
  }

  if (state.endsAt) {
    if (state.startsAt && state.endsAt <= state.startsAt) {
      errors.endsAt = tValidation('endsAtBeforeStart');
    } else {
      spec.endsAt = `${state.endsAt}T00:00:00Z`;
    }
  }

  if (state.limitStr) {
    if (!/^\d+$/.test(state.limitStr)) {
      errors.limit = tValidation('limitInvalid');
    } else {
      const n = Number(state.limitStr);
      if (n < 1) errors.limit = tValidation('limitInvalid');
      else spec.limit = n;
    }
  }

  // Cross-field sanity: at least one of cron / everyMs must be present.
  if (spec.cron === undefined && spec.everyMs === undefined) {
    if (!errors.cron && !errors.every) {
      errors.spec = tValidation('specRequired');
    }
  }

  const ok = Object.keys(errors).length === 0;
  return { ok, spec, errors };
}

export interface TransactionScheduleSubFormProps {
  state: ScheduleSubFormState;
  errors: ScheduleSubFormErrors;
  onChange(next: ScheduleSubFormState): void;
  disabled?: boolean;
}

export function TransactionScheduleSubForm({
  state,
  errors,
  onChange,
  disabled,
}: TransactionScheduleSubFormProps) {
  const t = useTranslations('transactions.schedule.form');

  const set = (patch: Partial<ScheduleSubFormState>) => onChange({ ...state, ...patch });

  return (
    <fieldset
      className="rounded-md border border-gray-200 p-3 dark:border-gray-700"
      data-testid="transaction-schedule-subform"
      aria-describedby="transaction-schedule-subform-help"
    >
      <legend className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
        {t('legend')}
      </legend>

      {/* Repeat mode radio group */}
      <div className="mb-3" role="radiogroup" aria-label={t('repeatModeLabel')}>
        <label className="mr-4 inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="radio"
            name="schedule-repeat-mode"
            value="every"
            checked={state.mode === 'every'}
            disabled={disabled}
            onChange={() => set({ mode: 'every' })}
            data-testid="schedule-mode-every"
            className="h-4 w-4"
          />
          <span>{t('repeatMode.every')}</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="radio"
            name="schedule-repeat-mode"
            value="cron"
            checked={state.mode === 'cron'}
            disabled={disabled}
            onChange={() => set({ mode: 'cron' })}
            data-testid="schedule-mode-cron"
            className="h-4 w-4"
          />
          <span>{t('repeatMode.cron')}</span>
        </label>
      </div>

      {/* Every <interval> path */}
      {state.mode === 'every' && (
        <div className="mb-3" data-testid="schedule-every-path">
          <div className="flex items-end gap-2">
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('every.label')}</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={state.everyCountStr}
                onChange={(e) => set({ everyCountStr: e.target.value })}
                disabled={disabled}
                data-testid="schedule-every-count"
                aria-invalid={!!errors.every}
                className="mt-1 w-24 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
            <select
              value={state.everyUnit}
              onChange={(e) => set({ everyUnit: e.target.value as ScheduleEveryUnit })}
              disabled={disabled}
              data-testid="schedule-every-unit"
              aria-label={t('every.unitLabel')}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="minute">{t('every.unitMinute')}</option>
              <option value="hour">{t('every.unitHour')}</option>
              <option value="day">{t('every.unitDay')}</option>
              <option value="week">{t('every.unitWeek')}</option>
              <option value="month">{t('every.unitMonth')}</option>
            </select>
          </div>
          <p
            className="mt-1 text-xs text-gray-500 dark:text-gray-400"
            id="transaction-schedule-subform-help"
          >
            {t('every.minHelp')}
          </p>
          {errors.every && (
            <span
              className="mt-1 block text-xs text-red-600"
              role="alert"
              data-testid="schedule-error-every"
            >
              {errors.every}
            </span>
          )}
        </div>
      )}

      {/* Cron path */}
      {state.mode === 'cron' && (
        <div className="mb-3" data-testid="schedule-cron-path">
          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('cron.label')}</span>
            <input
              type="text"
              value={state.cron}
              onChange={(e) => set({ cron: e.target.value })}
              placeholder="0 9 * * 1"
              disabled={disabled}
              data-testid="schedule-cron-input"
              aria-invalid={!!errors.cron}
              spellCheck={false}
              autoComplete="off"
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('cron.help')}</p>
          {errors.cron && (
            <span
              className="mt-1 block text-xs text-red-600"
              role="alert"
              data-testid="schedule-error-cron"
            >
              {errors.cron}
            </span>
          )}
        </div>
      )}

      {/* Starts on / Ends on / Limit */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span>{t('startsAt.label')}</span>
          <input
            type="date"
            value={state.startsAt}
            onChange={(e) => set({ startsAt: e.target.value })}
            disabled={disabled}
            data-testid="schedule-starts-at"
            aria-invalid={!!errors.startsAt}
            className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {errors.startsAt && (
            <span
              className="mt-1 text-xs text-red-600"
              role="alert"
              data-testid="schedule-error-starts-at"
            >
              {errors.startsAt}
            </span>
          )}
        </label>

        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span>{t('endsAt.label')}</span>
          <input
            type="date"
            value={state.endsAt}
            onChange={(e) => set({ endsAt: e.target.value })}
            disabled={disabled}
            data-testid="schedule-ends-at"
            aria-invalid={!!errors.endsAt}
            className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {errors.endsAt && (
            <span
              className="mt-1 text-xs text-red-600"
              role="alert"
              data-testid="schedule-error-ends-at"
            >
              {errors.endsAt}
            </span>
          )}
        </label>

        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          <span>{t('limit.label')}</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={state.limitStr}
            onChange={(e) => set({ limitStr: e.target.value })}
            disabled={disabled}
            data-testid="schedule-limit"
            aria-invalid={!!errors.limit}
            className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {errors.limit && (
            <span
              className="mt-1 text-xs text-red-600"
              role="alert"
              data-testid="schedule-error-limit"
            >
              {errors.limit}
            </span>
          )}
        </label>
      </div>

      {errors.spec && (
        <span
          className="mt-2 block text-xs text-red-600"
          role="alert"
          data-testid="schedule-error-spec"
        >
          {errors.spec}
        </span>
      )}
    </fieldset>
  );
}
