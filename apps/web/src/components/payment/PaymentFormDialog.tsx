'use client';

// Phase 6 · Iteration 6.13 — create + edit ONE_TIME payment dialog.
//
// Wraps <PaymentScopeSelector>, <PaymentCategoryPicker>, <PaymentTypeSelector>.
// Validation is synchronous and runs on save. `computeDiff` builds a minimal
// PATCH payload in edit mode so the backend audit log stays tight.
// RECURRING / INSTALLMENT / LOAN / MORTGAGE are not supported here — the
// dialog shows a read-only notice when asked to edit such a payment.

import { CURRENCY_CODES } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PaymentCategoryPicker } from './PaymentCategoryPicker';
import { PaymentScopeSelector } from './PaymentScopeSelector';
import { PaymentTypeSelector } from './PaymentTypeSelector';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import { usePayments } from '@/lib/payment/payment-context';
import {
  getLastUsedDirection,
  getLastUsedScopes,
  setLastUsedDirection,
  setLastUsedScopes,
  setLastUsedType,
} from '@/lib/payment/remember';
import type {
  AttributionScope,
  CategoryDto,
  CreatePaymentInput,
  PaymentDirection,
  PaymentSummary,
  PaymentType,
  UpdatePaymentInput,
} from '@/lib/payment/types';

export interface PaymentFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** Required in 'edit' mode. */
  payment?: PaymentSummary;
  defaults?: Partial<{
    direction: PaymentDirection;
    scope: AttributionScope[];
    categoryId: string;
    currency: string;
  }>;
  onClose(): void;
  onSaved(payment: PaymentSummary | null): void;
  /** Optional shared categories list. */
  categories?: CategoryDto[] | null;
}

interface FormState {
  direction: PaymentDirection;
  amountStr: string; // raw string so we can validate empty / negative.
  currency: string;
  occurredAt: string; // yyyy-mm-dd
  categoryId: string | null;
  scopes: AttributionScope[];
  note: string;
  type: PaymentType;
}

interface ValidationErrors {
  amount?: string;
  currency?: string;
  date?: string;
  category?: string;
  scopes?: string;
  note?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function paymentToState(p: PaymentSummary): FormState {
  return {
    direction: p.direction,
    amountStr: (p.amountCents / 100).toFixed(2),
    currency: p.currency,
    occurredAt: p.occurredAt.slice(0, 10),
    categoryId: p.category.id,
    scopes: p.attributions.map((a) =>
      a.scope === 'personal'
        ? ({ scope: 'personal' } as AttributionScope)
        : ({ scope: 'group', groupId: a.groupId! } as AttributionScope),
    ),
    note: p.note ?? '',
    type: (p.type as PaymentType) || 'ONE_TIME',
  };
}

/** Determine which attributions on an existing payment are NOT accessible by the caller. */
function findNonAccessibleAttributions(
  payment: PaymentSummary,
  currentUserId: string | null,
  groupIds: Set<string>,
): PaymentSummary['attributions'] {
  return payment.attributions.filter((a) => {
    if (a.scope === 'personal') return a.userId !== currentUserId;
    if (a.scope === 'group') return !(a.groupId && groupIds.has(a.groupId));
    return true;
  });
}

function findAccessibleAttributions(
  payment: PaymentSummary,
  currentUserId: string | null,
  groupIds: Set<string>,
): AttributionScope[] {
  const result: AttributionScope[] = [];
  for (const a of payment.attributions) {
    if (a.scope === 'personal' && a.userId === currentUserId) {
      result.push({ scope: 'personal' });
    } else if (a.scope === 'group' && a.groupId && groupIds.has(a.groupId)) {
      result.push({ scope: 'group', groupId: a.groupId });
    }
  }
  return result;
}

/** Build a minimal UpdatePaymentInput containing only the changed fields. */
export function computeDiff(
  original: PaymentSummary,
  draft: FormState,
  draftAmountCents: number,
  draftOccurredAt: string,
): UpdatePaymentInput {
  const diff: UpdatePaymentInput = {};

  if (draft.direction !== original.direction) diff.direction = draft.direction;
  if (draftAmountCents !== original.amountCents) diff.amountCents = draftAmountCents;
  if (draft.currency !== original.currency) diff.currency = draft.currency;
  if (draftOccurredAt !== original.occurredAt) diff.occurredAt = draftOccurredAt;
  if (draft.categoryId && draft.categoryId !== original.category.id) {
    diff.categoryId = draft.categoryId;
  }

  const normalizedDraftNote = draft.note.length === 0 ? null : draft.note;
  const originalNote = original.note ?? null;
  if (normalizedDraftNote !== originalNote) {
    diff.note = normalizedDraftNote;
  }

  // Compare scopes (unordered). Encode as sorted tokens.
  const toToken = (s: AttributionScope) =>
    s.scope === 'personal' ? 'personal' : `group:${s.groupId}`;
  const draftTokens = draft.scopes.map(toToken).sort();
  const originalTokens = original.attributions
    .map((a) => (a.scope === 'personal' ? 'personal' : `group:${a.groupId}`))
    .sort();
  const tokensMatch =
    draftTokens.length === originalTokens.length &&
    draftTokens.every((t, i) => t === originalTokens[i]);
  if (!tokensMatch) {
    diff.attributions = draft.scopes;
  }

  return diff;
}

function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const val = Number(trimmed);
  if (Number.isNaN(val)) return null;
  return Math.round(val * 100);
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

export function PaymentFormDialog({
  open,
  mode,
  payment,
  defaults,
  onClose,
  onSaved,
  categories,
}: PaymentFormDialogProps) {
  const t = useTranslations('payments.form');
  const tValidation = useTranslations('payments.form.validation');
  const { user } = useAuth();
  const { groups } = useGroups();
  const { createPayment, updatePayment } = usePayments();

  const groupIdSet = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);

  // ── Build initial state ─────────────────────────────────────────────────

  const initialState = useMemo<FormState>(() => {
    if (mode === 'edit' && payment) {
      return paymentToState(payment);
    }
    const direction = defaults?.direction ?? getLastUsedDirection();
    const scopes =
      defaults?.scope ??
      (typeof window !== 'undefined' ? getLastUsedScopes() : [{ scope: 'personal' }]);
    return {
      direction,
      amountStr: '',
      currency: defaults?.currency ?? user?.defaultCurrency ?? 'USD',
      occurredAt: todayIso(),
      categoryId: defaults?.categoryId ?? null,
      scopes,
      note: '',
      type: 'ONE_TIME',
    };
  }, [mode, payment?.id]);

  const [state, setState] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialStateRef = useRef(initialState);

  // Reset when reopened.
  useEffect(() => {
    if (open) {
      setState(initialState);
      initialStateRef.current = initialState;
      setErrors({});
      setFormError(null);
      setSaving(false);
      setConfirmDiscard(false);
    }
  }, [open, initialState]);

  // Focus direction button on open.
  const directionRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open && directionRef.current) {
      directionRef.current.focus();
    }
  }, [open]);

  // ── Edit-mode constraints ────────────────────────────────────────────────

  const isGeneratedOccurrence =
    mode === 'edit' && payment
      ? payment.parentPaymentId !== null || payment.type !== 'ONE_TIME'
      : false;

  const nonAccessibleAttributions =
    mode === 'edit' && payment
      ? findNonAccessibleAttributions(payment, user?.id ?? null, groupIdSet)
      : [];

  const accessibleInitial =
    mode === 'edit' && payment
      ? findAccessibleAttributions(payment, user?.id ?? null, groupIdSet)
      : [];

  // For edit mode with non-accessible attributions, constrain scopes to only the accessible ones.
  // Initial state already set above from payment.attributions; but we want the UI to only
  // operate on the accessible subset. Replace scopes initial when edit + non-accessibles exist.
  useEffect(() => {
    if (mode === 'edit' && payment && nonAccessibleAttributions.length > 0) {
      setState((s) => ({ ...s, scopes: accessibleInitial }));
      initialStateRef.current = { ...initialStateRef.current, scopes: accessibleInitial };
    }
  }, [mode, payment?.id]);

  // ── Validation ───────────────────────────────────────────────────────────

  function validate(
    s: FormState,
    cats: CategoryDto[] | null | undefined,
  ): { ok: boolean; amountCents: number; occurredAtIso: string; errors: ValidationErrors } {
    const next: ValidationErrors = {};
    const cents = parseAmountToCents(s.amountStr);
    if (cents === null || cents <= 0) next.amount = tValidation('amountRequired');

    if (
      !/^[A-Z]{3}$/.test(s.currency) ||
      !(CURRENCY_CODES as readonly string[]).includes(s.currency)
    ) {
      next.currency = tValidation('currencyInvalid');
    }

    // date must parse and not be > today + 1d
    const d = new Date(`${s.occurredAt}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      next.date = tValidation('dateInvalid');
    } else {
      const tomorrow = new Date();
      tomorrow.setUTCHours(0, 0, 0, 0);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      if (d.getTime() > tomorrow.getTime()) {
        next.date = tValidation('dateFuture');
      }
    }

    if (!s.categoryId) {
      next.category = tValidation('categoryRequired');
    } else if (cats && cats.length > 0) {
      const cat = cats.find((c) => c.id === s.categoryId);
      if (cat && cat.direction !== 'BOTH' && cat.direction !== s.direction) {
        next.category = tValidation('categoryDirectionMismatch');
      }
    }

    if (!s.scopes || s.scopes.length === 0) {
      next.scopes = tValidation('scopesRequired');
    }

    if (s.note.length > 2000) {
      next.note = tValidation('noteTooLong');
    }

    return {
      ok: Object.keys(next).length === 0,
      amountCents: cents ?? 0,
      occurredAtIso: `${s.occurredAt}T00:00:00Z`,
      errors: next,
    };
  }

  // ── Save handler ─────────────────────────────────────────────────────────

  async function onSave() {
    if (isGeneratedOccurrence) return;
    const { ok, amountCents, occurredAtIso, errors: valErrors } = validate(state, categories);
    setErrors(valErrors);
    if (!ok) return;

    setSaving(true);
    setFormError(null);
    try {
      if (mode === 'create') {
        const payload: CreatePaymentInput = {
          direction: state.direction,
          type: 'ONE_TIME',
          amountCents,
          currency: state.currency,
          occurredAt: occurredAtIso,
          categoryId: state.categoryId!,
          note: state.note.length > 0 ? state.note : undefined,
          attributions: state.scopes,
        };
        const created = await createPayment(payload);
        setLastUsedDirection(state.direction);
        setLastUsedScopes(state.scopes);
        setLastUsedType('ONE_TIME');
        onSaved(created);
        onClose();
      } else if (mode === 'edit' && payment) {
        const diff = computeDiff(payment, state, amountCents, occurredAtIso);
        if (Object.keys(diff).length === 0) {
          // Nothing to change — just close.
          onSaved(payment);
          onClose();
          return;
        }
        const result = await updatePayment(payment.id, diff);
        onSaved(result);
        onClose();
      }
    } catch (e) {
      setFormError(extractMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Draft-change detection for ESC confirm ───────────────────────────────

  function isDirty(): boolean {
    const a = initialStateRef.current;
    const b = state;
    return (
      a.direction !== b.direction ||
      a.amountStr !== b.amountStr ||
      a.currency !== b.currency ||
      a.occurredAt !== b.occurredAt ||
      a.categoryId !== b.categoryId ||
      a.note !== b.note ||
      JSON.stringify(a.scopes) !== JSON.stringify(b.scopes)
    );
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isDirty()) {
          setConfirmDiscard(true);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, state]);

  if (!open) return null;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (isDirty()) setConfirmDiscard(true);
      else onClose();
    }
  };

  // Build currency list: user's default first, rest alphabetical (unique).
  const defaultCurrency = state.currency;
  const sortedCurrencies = [
    defaultCurrency,
    ...[...CURRENCY_CODES].filter((c) => c !== defaultCurrency).sort(),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-form-title"
      data-testid="payment-form-dialog"
      onMouseDown={handleBackdrop}
    >
      <div className="mx-4 max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3
            id="payment-form-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {mode === 'create' ? t('createTitle') : t('editTitle')}
          </h3>
          <button
            type="button"
            onClick={() => (isDirty() ? setConfirmDiscard(true) : onClose())}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label={t('close')}
            data-testid="payment-form-close"
          >
            ✕
          </button>
        </div>

        {isGeneratedOccurrence && (
          <div
            className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
            role="alert"
            data-testid="payment-form-occurrence-banner"
          >
            {t('occurrenceNotEditable')}
          </div>
        )}

        {/* Direction */}
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('direction')}
          </div>
          <div
            className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600"
            role="group"
            aria-label={t('direction')}
          >
            <button
              ref={directionRef}
              type="button"
              onClick={() => setState((s) => ({ ...s, direction: 'IN' }))}
              disabled={isGeneratedOccurrence}
              aria-pressed={state.direction === 'IN'}
              data-testid="form-direction-in"
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                state.direction === 'IN'
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {t('directionIn')}
            </button>
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, direction: 'OUT' }))}
              disabled={isGeneratedOccurrence}
              aria-pressed={state.direction === 'OUT'}
              data-testid="form-direction-out"
              className={`border-l border-gray-300 px-3 py-1.5 text-sm font-medium transition-colors dark:border-gray-600 ${
                state.direction === 'OUT'
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {t('directionOut')}
            </button>
          </div>
        </div>

        {/* Amount + Currency + Date */}
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('amount')}</span>
            <input
              type="text"
              inputMode="decimal"
              value={state.amountStr}
              onChange={(e) => setState((s) => ({ ...s, amountStr: e.target.value }))}
              placeholder={t('amountPlaceholder')}
              disabled={isGeneratedOccurrence}
              data-testid="form-amount"
              aria-invalid={!!errors.amount}
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            {errors.amount && (
              <span className="mt-1 text-xs text-red-600" data-testid="form-error-amount">
                {errors.amount}
              </span>
            )}
          </label>

          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('currency')}</span>
            <select
              value={state.currency}
              onChange={(e) => setState((s) => ({ ...s, currency: e.target.value }))}
              disabled={isGeneratedOccurrence}
              data-testid="form-currency"
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              {sortedCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {errors.currency && (
              <span className="mt-1 text-xs text-red-600" data-testid="form-error-currency">
                {errors.currency}
              </span>
            )}
          </label>

          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('date')}</span>
            <input
              type="date"
              value={state.occurredAt}
              onChange={(e) => setState((s) => ({ ...s, occurredAt: e.target.value }))}
              disabled={isGeneratedOccurrence}
              data-testid="form-date"
              aria-invalid={!!errors.date}
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            {errors.date && (
              <span className="mt-1 text-xs text-red-600" data-testid="form-error-date">
                {errors.date}
              </span>
            )}
          </label>
        </div>

        {/* Category */}
        <div className="mb-3">
          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('category')}</span>
            <div className="mt-1">
              <PaymentCategoryPicker
                direction={state.direction}
                value={state.categoryId}
                onChange={(id) => setState((s) => ({ ...s, categoryId: id }))}
                categories={categories}
                disabled={isGeneratedOccurrence}
                testId="form-category-picker"
              />
            </div>
          </label>
          {errors.category && (
            <span className="mt-1 text-xs text-red-600" data-testid="form-error-category">
              {errors.category}
            </span>
          )}
        </div>

        {/* Scopes */}
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('attributedTo')}
          </div>
          <PaymentScopeSelector
            value={state.scopes}
            onChange={(next) => setState((s) => ({ ...s, scopes: next }))}
            disabled={isGeneratedOccurrence}
          />
          {errors.scopes && (
            <span className="mt-1 text-xs text-red-600" data-testid="form-error-scopes">
              {errors.scopes}
            </span>
          )}
          {nonAccessibleAttributions.length > 0 && (
            <p
              className="mt-1 text-xs italic text-gray-500 dark:text-gray-400"
              data-testid="form-non-accessible-footnote"
            >
              {t('othersCount', { count: nonAccessibleAttributions.length })} {t('othersPreserved')}
            </p>
          )}
        </div>

        {/* Note */}
        <div className="mb-3">
          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('noteLabel')}</span>
            <textarea
              value={state.note}
              onChange={(e) => setState((s) => ({ ...s, note: e.target.value }))}
              placeholder={t('notePlaceholder')}
              rows={2}
              maxLength={2000}
              disabled={isGeneratedOccurrence}
              data-testid="form-note"
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>
          {errors.note && (
            <span className="mt-1 text-xs text-red-600" data-testid="form-error-note">
              {errors.note}
            </span>
          )}
        </div>

        {/* Type */}
        <div className="mb-4">
          <PaymentTypeSelector
            value={state.type}
            onChange={(next) => setState((s) => ({ ...s, type: next }))}
            disabled={isGeneratedOccurrence}
          />
        </div>

        {formError && (
          <div
            className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
            role="alert"
            data-testid="form-api-error"
          >
            {t('errorGeneric', { message: formError })}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={() => (isDirty() ? setConfirmDiscard(true) : onClose())}
            disabled={saving}
            data-testid="form-cancel"
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1"
            onClick={onSave}
            disabled={saving || isGeneratedOccurrence}
            data-testid="form-save"
          >
            {saving ? t('saving') : t('save')}
          </Button>
        </div>

        {confirmDiscard && (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            role="alert"
            data-testid="form-discard-prompt"
          >
            <p className="mb-2">{t('discardChanges')}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDiscard(false)}
                data-testid="form-discard-keep"
              >
                {t('keepEditing')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onClose}
                data-testid="form-discard-confirm"
                className="!bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
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
