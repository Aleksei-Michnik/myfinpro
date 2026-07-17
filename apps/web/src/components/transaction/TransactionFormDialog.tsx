'use client';

// Phase 6 · Iteration 6.13 — create + edit ONE_TIME transaction dialog.
// Phase 6 · Iteration 6.16.4 — save flow migrated to useAsyncOperation
// ({ scope: 'control' }). Save button shows <ButtonSpinner>, disabled
// inputs and aria-busy on the form. Cancel triggers cancel() on the
// in-flight op. Network/timeout/HTTP failures shown via inline banner
// with Retry. Domain errors (TRANSACTION_INVALID_*) still map to per-field
// errors.

import { CURRENCY_CODES, isPlanKind } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PropagationChoiceDialog } from './PropagationChoiceDialog';
import { TransactionCategoryPicker } from './TransactionCategoryPicker';
import {
  TransactionPlanSubForm,
  buildPlanSpec,
  defaultPlanSubFormState,
  type PlanSubFormErrors,
  type PlanSubFormState,
} from './TransactionPlanSubForm';
import {
  TransactionScheduleSubForm,
  buildScheduleSpec,
  defaultScheduleSubFormState,
  scheduleResponseToFormState,
  type ScheduleSubFormErrors,
  type ScheduleSubFormState,
} from './TransactionScheduleSubForm';
import { TransactionScopeSelector } from './TransactionScopeSelector';
import { TransactionTypeSelector } from './TransactionTypeSelector';
import { ManualReceiptDialog } from '@/components/receipt/ManualReceiptDialog';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useToast } from '@/components/ui/Toast';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { isoToLocalInput, localInputToIso, nowLocalIso } from '@/lib/datetime';
import { useGroups } from '@/lib/group/group-context';
import { parseAmountToCents } from '@/lib/money';
import { useReceipts } from '@/lib/receipt/receipt-context';
import {
  getLastUsedDirection,
  getLastUsedScopes,
  setLastUsedDirection,
  setLastUsedScopes,
  setLastUsedType,
} from '@/lib/transaction/remember';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type {
  AttributionScope,
  CascadeEditResult,
  CategoryDto,
  CreateTransactionInput,
  TransactionDirection,
  TransactionPropagateMode,
  TransactionSummary,
  TransactionType,
  ScheduleResponse,
  UpdateTransactionInput,
} from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface TransactionFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** Required in 'edit' mode. */
  transaction?: TransactionSummary;
  /**
   * Existing schedule attached to `transaction` (edit mode). Required for
   * pre-filling the schedule sub-form when editing a RECURRING transaction.
   * `null` when no schedule is attached or when the parent is ONE_TIME.
   */
  existingSchedule?: ScheduleResponse | null;
  defaults?: Partial<{
    direction: TransactionDirection;
    scope: AttributionScope[];
    categoryId: string;
    currency: string;
  }>;
  onClose(): void;
  onSaved(transaction: TransactionSummary | null): void;
  /** Optional shared categories list. */
  categories?: CategoryDto[] | null;
}

interface FormState {
  direction: TransactionDirection;
  amountStr: string; // raw string so we can validate empty / negative.
  currency: string;
  /**
   * `<input type="datetime-local">` value — `YYYY-MM-DDTHH:mm` (no
   * seconds, no timezone). Phase 6 · Iteration 6.18.1.2 widened this
   * from a date-only `YYYY-MM-DD` so users can pick the actual time of
   * day on `occurredAt`.
   */
  occurredAt: string;
  categoryId: string | null;
  scopes: AttributionScope[];
  note: string;
  type: TransactionType;
}

interface ValidationErrors {
  amount?: string;
  currency?: string;
  date?: string;
  category?: string;
  scopes?: string;
  note?: string;
}

function transactionToState(p: TransactionSummary): FormState {
  return {
    direction: p.direction,
    amountStr: (p.amountCents / 100).toFixed(2),
    currency: p.currency,
    occurredAt: isoToLocalInput(p.occurredAt),
    categoryId: p.category.id,
    scopes: p.attributions.map((a) =>
      a.scope === 'personal'
        ? ({ scope: 'personal' } as AttributionScope)
        : ({ scope: 'group', groupId: a.groupId! } as AttributionScope),
    ),
    note: p.note ?? '',
    type: (p.type as TransactionType) || 'ONE_TIME',
  };
}

/** Determine which attributions on an existing transaction are NOT accessible by the caller. */
function findNonAccessibleAttributions(
  transaction: TransactionSummary,
  currentUserId: string | null,
  groupIds: Set<string>,
): TransactionSummary['attributions'] {
  return transaction.attributions.filter((a) => {
    if (a.scope === 'personal') return a.userId !== currentUserId;
    if (a.scope === 'group') return !(a.groupId && groupIds.has(a.groupId));
    return true;
  });
}

function findAccessibleAttributions(
  transaction: TransactionSummary,
  currentUserId: string | null,
  groupIds: Set<string>,
): AttributionScope[] {
  const result: AttributionScope[] = [];
  for (const a of transaction.attributions) {
    if (a.scope === 'personal' && a.userId === currentUserId) {
      result.push({ scope: 'personal' });
    } else if (a.scope === 'group' && a.groupId && groupIds.has(a.groupId)) {
      result.push({ scope: 'group', groupId: a.groupId });
    }
  }
  return result;
}

/** Build a minimal UpdateTransactionInput containing only the changed fields. */
export function computeDiff(
  original: TransactionSummary,
  draft: FormState,
  draftAmountCents: number,
  draftOccurredAt: string,
): UpdateTransactionInput {
  const diff: UpdateTransactionInput = {};

  if (draft.direction !== original.direction) diff.direction = draft.direction;
  if (draftAmountCents !== original.amountCents) diff.amountCents = draftAmountCents;
  if (draft.currency !== original.currency) diff.currency = draft.currency;
  // Compare timestamps numerically — the datetime-local round-trip emits
  // millisecond precision (`.000Z`) while the API may have stored the row
  // with a bare `Z` suffix; both encode the same instant.
  const draftMs = new Date(draftOccurredAt).getTime();
  const originalMs = new Date(original.occurredAt).getTime();
  if (Number.isFinite(draftMs) && Number.isFinite(originalMs) && draftMs !== originalMs) {
    diff.occurredAt = draftOccurredAt;
  }
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

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

export function TransactionFormDialog({
  open,
  mode,
  transaction,
  existingSchedule,
  defaults,
  onClose,
  onSaved,
  categories,
}: TransactionFormDialogProps) {
  const t = useTranslations('transactions.form');
  const tValidation = useTranslations('transactions.form.validation');
  const tSchedule = useTranslations('transactions.schedule.form');
  const tScheduleValidation = useTranslations('transactions.schedule.form.validation');
  const tPropagate = useTranslations('transactions.propagate');
  const tPlanValidation = useTranslations('transactions.plan.form.validation');
  const { addToast } = useToast();
  const { user } = useAuth();
  const { groups } = useGroups();
  const {
    createTransaction,
    updateTransaction,
    editTransactionWithPropagation,
    removeTransaction,
    createSchedule,
    replaceSchedule,
    getTransaction,
    listOccurrences,
  } = useTransactions();

  // Phase 7.13 — transaction-first receipt intake: a receipt is the transaction's
  // proving document, so its upload starts here. Phase 8.13 turns the single
  // file picker into an intake chooser (device upload / e-receipt URL —
  // design: docs/phase-8-receipt-intake-design.md §1). Either path creates
  // the receipt and hands off to the extract → review → confirm pipeline,
  // which ends in the transaction this dialog would otherwise create by hand.
  const router = useRouter();
  const { uploadReceipt, createFromUrl } = useReceipts();
  const receiptFileRef = useRef<HTMLInputElement | null>(null);
  const receiptUrlInputRef = useRef<HTMLInputElement | null>(null);
  const [receiptUrlOpen, setReceiptUrlOpen] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [manualReceiptOpen, setManualReceiptOpen] = useState(false);
  const receiptOp = useAsyncOperation<boolean>({ scope: 'control' });
  const routeToReview = (receiptId: string) => {
    router.push(`/receipts/${receiptId}`);
    onClose();
  };
  const handoffToReview = (create: (signal: AbortSignal) => Promise<{ id: string }>) => {
    void receiptOp
      .run(async (signal) => {
        const created = await create(signal);
        router.push(`/receipts/${created.id}`);
        return true;
      })
      .then((r) => {
        if (r !== undefined) onClose();
      });
  };
  const handleReceiptFile = (file: File | undefined) => {
    if (!file) return;
    handoffToReview((signal) => uploadReceipt([file], signal));
  };
  const handleReceiptUrl = () => {
    const url = receiptUrl.trim();
    if (!url) return;
    handoffToReview((signal) => createFromUrl(url, signal));
  };
  useEffect(() => {
    if (receiptOp.error && receiptOp.error.reason !== 'aborted') {
      addToast('error', receiptOp.error.message || t('fromReceiptFailed'));
    }
  }, [receiptOp.error, addToast, t]);

  // Phase 6 · 6.18.1.4-hotfix — refetch the freshest copy of the transaction
  // when the dialog opens in edit mode. Without this we'd render stale
  // data from the list cache (a transaction edited on another tab/device
  // would surface old values until the user navigated away). Falls back
  // to the prop if the fetch fails.
  const refetchOp = useAsyncOperation<TransactionSummary>({ scope: 'control' });
  const [refetchedTransaction, setRefetchedTransaction] = useState<TransactionSummary | null>(null);
  const isInitialLoad =
    mode === 'edit' && !!transaction && refetchOp.isLoading && refetchedTransaction === null;

  // The form populates from the freshest copy when available; otherwise
  // the prop, which preserves the existing behaviour when the fetch
  // fails or while the request is in flight.
  const effectiveTransaction: TransactionSummary | undefined =
    mode === 'edit' ? (refetchedTransaction ?? transaction) : transaction;

  const groupIdSet = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);

  // ── Build initial state ─────────────────────────────────────────────────

  const initialState = useMemo<FormState>(() => {
    if (mode === 'edit' && effectiveTransaction) {
      return transactionToState(effectiveTransaction);
    }
    const direction = defaults?.direction ?? getLastUsedDirection();
    const scopes =
      defaults?.scope ??
      (typeof window !== 'undefined' ? getLastUsedScopes() : [{ scope: 'personal' }]);
    return {
      direction,
      amountStr: '',
      currency: defaults?.currency ?? user?.defaultCurrency ?? 'USD',
      occurredAt: nowLocalIso(),
      categoryId: defaults?.categoryId ?? null,
      scopes,
      note: '',
      type: 'ONE_TIME',
    };
  }, [mode, effectiveTransaction?.id, refetchedTransaction]);

  // Schedule sub-form state — sticky across type-toggles. Pre-filled from
  // the existing schedule on the edit path; otherwise defaults.
  const initialScheduleState = useMemo<ScheduleSubFormState>(() => {
    if (existingSchedule) return scheduleResponseToFormState(existingSchedule);
    return defaultScheduleSubFormState();
  }, [existingSchedule?.id]);

  const [state, setState] = useState<FormState>(initialState);
  const [scheduleState, setScheduleState] = useState<ScheduleSubFormState>(initialScheduleState);
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleSubFormErrors>({});
  // Plan sub-form state (6.20) — sticky across type toggles, create-only.
  const [planState, setPlanState] = useState<PlanSubFormState>(defaultPlanSubFormState());
  const [planErrors, setPlanErrors] = useState<PlanSubFormErrors>({});
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialStateRef = useRef(initialState);
  const initialScheduleStateRef = useRef(initialScheduleState);

  // Save flow runs through the universal control-scope async hook.
  const saveOp = useAsyncOperation<TransactionSummary | null>({ scope: 'control' });
  // Cascade-edit flow (Phase 6 · 6.18.1.5) — its own control-scope op so the
  // confirm spinner in <PropagationChoiceDialog> is independent of saveOp.
  const cascadeOp = useAsyncOperation<CascadeEditResult>({ scope: 'control' });
  const isLoading = saveOp.isLoading || cascadeOp.isLoading;

  // Whether the parent (edit mode, RECURRING) has ≥1 child occurrence. Drives
  // the decision to show <PropagationChoiceDialog> on save.
  const [hasChildren, setHasChildren] = useState(false);
  const [showPropagation, setShowPropagation] = useState(false);
  // The validated edit payload, stashed while the propagation dialog is open.
  const pendingEditRef = useRef<{
    diff: UpdateTransactionInput;
    scheduleBuild: ReturnType<typeof buildScheduleSpec> | null;
    willBeRecurring: boolean;
  } | null>(null);

  // Reset when reopened.
  useEffect(() => {
    if (open) {
      setState(initialState);
      initialStateRef.current = initialState;
      setScheduleState(initialScheduleState);
      initialScheduleStateRef.current = initialScheduleState;
      setScheduleErrors({});
      setPlanState(defaultPlanSubFormState());
      setPlanErrors({});
      setErrors({});
      setConfirmDiscard(false);
      saveOp.reset();
    } else {
      // Closed mid-flight → abort.
      saveOp.cancel();
      // Drop any refetched copy so reopening for a different transaction
      // does not flash old data while the new fetch is in flight.
      setRefetchedTransaction(null);
      refetchOp.cancel();
    }
    // saveOp identity is stable; including it would re-fire on unrelated churn.
  }, [open, initialState, initialScheduleState]);

  // Phase 6 · 6.18.1.4-hotfix — fetch the freshest transaction when the
  // dialog opens in edit mode. Falls back to the prop on failure.
  useEffect(() => {
    if (!open || mode !== 'edit' || !transaction) return;
    void refetchOp
      .run((signal) => getTransaction(transaction.id, signal))
      .then((fresh) => {
        if (fresh) setRefetchedTransaction(fresh);
      });
    // refetchOp / getTransaction identities are stable; the only dependencies
    // that should re-fire the fetch are open / mode / transaction.id.
  }, [open, mode, transaction?.id]);

  // Phase 6 · 6.18.1.5 — detect whether a RECURRING parent has ≥1 child
  // occurrence. Drives whether Save opens the propagation dialog. Probe with
  // limit=1 (we only need presence; the exact counts come from the cascade
  // response). Non-recurring transactions never have children → skip.
  useEffect(() => {
    if (!open || mode !== 'edit' || !transaction) {
      setHasChildren(false);
      return;
    }
    if (transaction.type !== 'RECURRING') {
      setHasChildren(false);
      return;
    }
    let cancelled = false;
    void listOccurrences(transaction.id, { limit: 1 })
      .then((res) => {
        if (!cancelled) setHasChildren(res.data.length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasChildren(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, transaction?.id, transaction?.type, listOccurrences]);

  // Focus direction button on open.
  const directionRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open && directionRef.current) {
      directionRef.current.focus();
    }
  }, [open]);

  // ── Edit-mode constraints ────────────────────────────────────────────────

  // A child occurrence (server-generated, parentTransactionId set) is read-only.
  // RECURRING parent transactions are editable from 6.18.1 onwards (the schedule
  // sub-form drives the spec). Other non-ONE_TIME types ship later.
  const isGeneratedOccurrence =
    mode === 'edit' && effectiveTransaction
      ? effectiveTransaction.parentTransactionId !== null ||
        (effectiveTransaction.type !== 'ONE_TIME' && effectiveTransaction.type !== 'RECURRING')
      : false;

  const nonAccessibleAttributions =
    mode === 'edit' && effectiveTransaction
      ? findNonAccessibleAttributions(effectiveTransaction, user?.id ?? null, groupIdSet)
      : [];

  const accessibleInitial =
    mode === 'edit' && effectiveTransaction
      ? findAccessibleAttributions(effectiveTransaction, user?.id ?? null, groupIdSet)
      : [];

  // For edit mode with non-accessible attributions, constrain scopes to only the accessible ones.
  useEffect(() => {
    if (mode === 'edit' && effectiveTransaction && nonAccessibleAttributions.length > 0) {
      setState((s) => ({ ...s, scopes: accessibleInitial }));
      initialStateRef.current = { ...initialStateRef.current, scopes: accessibleInitial };
    }
  }, [mode, effectiveTransaction?.id]);

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

    // datetime-local interpreted as local time → UTC ISO. Reject empty
    // and far-future timestamps (allow up to 1 day ahead, mirroring the
    // pre-6.18.1.2 date-only behaviour).
    const d = s.occurredAt ? new Date(s.occurredAt) : new Date(NaN);
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
      occurredAtIso: localInputToIso(s.occurredAt),
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
    if (code === 'TRANSACTION_INVALID_AMOUNT') {
      setErrors((prev) => ({ ...prev, amount: extractMessage(err) }));
      return true;
    }
    if (code === 'TRANSACTION_INVALID_CURRENCY') {
      setErrors((prev) => ({ ...prev, currency: extractMessage(err) }));
      return true;
    }
    if (code === 'TRANSACTION_INVALID_DATE') {
      setErrors((prev) => ({ ...prev, date: extractMessage(err) }));
      return true;
    }
    if (
      code === 'TRANSACTION_CATEGORY_INVALID' ||
      code === 'TRANSACTION_CATEGORY_DIRECTION_MISMATCH'
    ) {
      setErrors((prev) => ({ ...prev, category: extractMessage(err) }));
      return true;
    }
    // Schedule-side domain errors map onto the schedule sub-form.
    if (code === 'TRANSACTION_SCHEDULE_INVALID_CRON') {
      setScheduleErrors((prev) => ({ ...prev, cron: extractMessage(err) }));
      return true;
    }
    if (code === 'TRANSACTION_SCHEDULE_INVALID_INTERVAL') {
      setScheduleErrors((prev) => ({ ...prev, every: extractMessage(err) }));
      return true;
    }
    if (code === 'TRANSACTION_SCHEDULE_INVALID_END_DATE') {
      setScheduleErrors((prev) => ({ ...prev, endsAt: extractMessage(err) }));
      return true;
    }
    if (
      code === 'TRANSACTION_SCHEDULE_INVALID_SPEC' ||
      code === 'TRANSACTION_SCHEDULE_PARENT_NOT_RECURRING' ||
      code === 'TRANSACTION_SCHEDULE_ALREADY_EXISTS'
    ) {
      setScheduleErrors((prev) => ({ ...prev, spec: extractMessage(err) }));
      return true;
    }
    return false;
  }

  function runSave() {
    if (isGeneratedOccurrence) return;
    const { ok, amountCents, occurredAtIso, errors: valErrors } = validate(state, categories);
    setErrors(valErrors);

    // When the transaction is RECURRING (create or edit-with-existing-or-new-schedule),
    // also validate the schedule sub-form. Mirror its build result locally so
    // the network calls don't fire on a partially-filled spec.
    let scheduleBuild: ReturnType<typeof buildScheduleSpec> | null = null;
    const wasRecurring =
      !!existingSchedule || (mode === 'edit' && effectiveTransaction?.type === 'RECURRING');
    const willBeRecurring = state.type === 'RECURRING';
    if (willBeRecurring) {
      scheduleBuild = buildScheduleSpec(scheduleState, tScheduleValidation);
      setScheduleErrors(scheduleBuild.errors);
    } else {
      setScheduleErrors({});
    }

    // Plan sub-form (6.20) — create-only; plan parents are not editable.
    const isPlanCreate = mode === 'create' && isPlanKind(state.type);
    let planBuild: ReturnType<typeof buildPlanSpec> | null = null;
    if (isPlanCreate) {
      planBuild = buildPlanSpec(planState, state.type, tPlanValidation);
      setPlanErrors(planBuild.errors);
    } else {
      setPlanErrors({});
    }

    if (!ok) return;
    if (willBeRecurring && scheduleBuild && !scheduleBuild.ok) return;
    if (isPlanCreate && planBuild && !planBuild.ok) return;

    // Phase 6 · 6.18.1.5 — when editing a RECURRING parent that has children,
    // and the diff touches a cascadeable non-period field, defer the submit
    // and open <PropagationChoiceDialog> so the user picks self/future/all.
    // occurredAt and type are NOT cascadeable (period/schedule stays read-only,
    // deferred to 6.18.2), so they don't trigger the dialog on their own.
    if (mode === 'edit' && effectiveTransaction) {
      const diff = computeDiff(effectiveTransaction, state, amountCents, occurredAtIso);
      const isTypeChange =
        state.type !== effectiveTransaction.type &&
        (state.type === 'ONE_TIME' || state.type === 'RECURRING');
      if (isTypeChange) diff.type = state.type as 'ONE_TIME' | 'RECURRING';
      const isRecurringParent =
        effectiveTransaction.type === 'RECURRING' && state.type === 'RECURRING';
      const cascadeableKeys = Object.keys(diff).filter((k) => k !== 'occurredAt' && k !== 'type');
      if (isRecurringParent && hasChildren && cascadeableKeys.length > 0) {
        pendingEditRef.current = { diff, scheduleBuild, willBeRecurring };
        setShowPropagation(true);
        return;
      }
    }

    void saveOp
      .run(async (signal) => {
        try {
          if (mode === 'create') {
            const payload: CreateTransactionInput = {
              direction: state.direction,
              type: isPlanCreate
                ? (state.type as 'INSTALLMENT' | 'LOAN' | 'MORTGAGE')
                : willBeRecurring
                  ? 'RECURRING'
                  : 'ONE_TIME',
              ...(isPlanCreate && planBuild ? { plan: planBuild.spec } : {}),
              amountCents,
              currency: state.currency,
              occurredAt: occurredAtIso,
              categoryId: state.categoryId!,
              note: state.note.length > 0 ? state.note : undefined,
              attributions: state.scopes,
            };
            const created = await createTransaction(payload, signal);
            // Two-step create for RECURRING: transaction, then schedule. Roll
            // back the transaction via DELETE on schedule failure to keep the
            // invariant "no recurring parent without a schedule" — see
            // 6.18.1 task spec.
            if (willBeRecurring && scheduleBuild) {
              try {
                await createSchedule(created.id, scheduleBuild.spec, signal);
              } catch (scheduleErr) {
                // Best-effort rollback. Use a fresh signal-less call so the
                // delete still completes if the user has navigated away.
                try {
                  await removeTransaction(created.id, 'all');
                } catch {
                  // Swallow — the transaction is now an orphan, but we've
                  // already surfaced the schedule error to the user.
                }
                throw scheduleErr;
              }
            }
            return created as TransactionSummary | null;
          }
          if (mode === 'edit' && effectiveTransaction) {
            const diff = computeDiff(effectiveTransaction, state, amountCents, occurredAtIso);
            // Type changed → include in diff so the API drives the cascade
            // (RECURRING → ONE_TIME tears down the schedule server-side per
            // 6.17.4). PATCH /transactions accepts `type` from 6.18.1 onwards.
            // The sub-form only ever lets the user pick ONE_TIME / RECURRING
            // in this iteration; narrow the assertion accordingly.
            if (
              state.type !== effectiveTransaction.type &&
              (state.type === 'ONE_TIME' || state.type === 'RECURRING')
            ) {
              diff.type = state.type;
            }
            let result: TransactionSummary | null = effectiveTransaction;
            if (Object.keys(diff).length > 0) {
              result = await updateTransaction(effectiveTransaction.id, diff, signal);
            }
            // Schedule edit: PUT when the transaction is (or becomes) RECURRING.
            if (willBeRecurring && scheduleBuild && result) {
              await replaceSchedule(result.id, scheduleBuild.spec, signal);
            }
            return result;
          }
          return null;
        } catch (e) {
          if (applyDomainError(e)) {
            // Treat as domain error — surface via per-field errors only.
            // Re-throw an aborted-style error so the hook does not show the
            // inline banner (it lands in 'error' with reason='aborted',
            // which we ignore in render).
            throw new DOMException('domain', 'AbortError');
          }
          throw e;
        }
      })
      .then((result) => {
        if (result === undefined) return; // either error, abort, or domain-error
        if (mode === 'create') {
          setLastUsedDirection(state.direction);
          setLastUsedScopes(state.scopes);
          setLastUsedType(willBeRecurring ? 'RECURRING' : 'ONE_TIME');
        }
        // Suppress unused-var lint when only used inside the closure.
        void wasRecurring;
        onSaved(result);
        onClose();
      });
  }

  // Phase 6 · 6.18.1.5 — submit the stashed edit with the chosen propagation
  // mode. Runs through the dedicated cascadeOp (control scope). On success a
  // result toast summarises the affected + skipped child counts.
  function submitWithPropagation(propagate: TransactionPropagateMode) {
    const pending = pendingEditRef.current;
    if (!pending || !effectiveTransaction) return;
    void cascadeOp
      .run(async (signal) => {
        try {
          const result = await editTransactionWithPropagation(
            effectiveTransaction.id,
            pending.diff,
            propagate,
            signal,
          );
          // Schedule editing stays on the parent only (untouched here; the
          // period spec is deferred to 6.18.2). Replace it if the sub-form
          // produced a new spec.
          if (pending.willBeRecurring && pending.scheduleBuild) {
            await replaceSchedule(result.transaction.id, pending.scheduleBuild.spec, signal);
          }
          return result;
        } catch (e) {
          if (applyDomainError(e)) {
            throw new DOMException('domain', 'AbortError');
          }
          throw e;
        }
      })
      .then((result) => {
        if (result === undefined) return; // error / abort / domain-error
        addToast('success', tPropagate('resultUpdated', { count: result.affectedChildrenCount }));
        if (result.skippedChildrenCount > 0) {
          addToast('info', tPropagate('resultSkipped', { count: result.skippedChildrenCount }));
        }
        pendingEditRef.current = null;
        setShowPropagation(false);
        onSaved(result.transaction);
        onClose();
      });
  }

  // Cancel the propagation dialog: abort the in-flight cascade (if any) and
  // return to the form with the user's edits intact (form state untouched).
  function cancelPropagation() {
    cascadeOp.cancel();
    pendingEditRef.current = null;
    setShowPropagation(false);
  }

  function handleCancel() {
    saveOp.cancel();
    if (isDirty()) setConfirmDiscard(true);
    else onClose();
  }

  // ── Draft-change detection for ESC confirm ───────────────────────────────

  function isDirty(): boolean {
    const a = initialStateRef.current;
    const b = state;
    if (
      a.direction !== b.direction ||
      a.amountStr !== b.amountStr ||
      a.currency !== b.currency ||
      a.occurredAt !== b.occurredAt ||
      a.categoryId !== b.categoryId ||
      a.note !== b.note ||
      a.type !== b.type ||
      JSON.stringify(a.scopes) !== JSON.stringify(b.scopes)
    ) {
      return true;
    }
    // Schedule sub-form dirtiness — compare deep.
    return JSON.stringify(initialScheduleStateRef.current) !== JSON.stringify(scheduleState);
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isDirty()) {
          setConfirmDiscard(true);
        } else {
          handleCancel();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, state, scheduleState]);

  if (!open) return null;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (isDirty()) setConfirmDiscard(true);
      else handleCancel();
    }
  };

  // Build currency list: user's default first, rest alphabetical (unique).
  const defaultCurrency = state.currency;
  const sortedCurrencies = [
    defaultCurrency,
    ...[...CURRENCY_CODES].filter((c) => c !== defaultCurrency).sort(),
  ];

  // Suppress 'aborted' (which we use for domain-error short-circuit) from
  // the inline banner.
  const showBanner = saveOp.isError && saveOp.error !== null && saveOp.error.reason !== 'aborted';

  const allInputsDisabled = isGeneratedOccurrence || isLoading || isInitialLoad;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transaction-form-title"
      data-testid="transaction-form-dialog"
      onMouseDown={handleBackdrop}
    >
      <div className="mx-4 max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3
            id="transaction-form-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {mode === 'create' ? t('createTitle') : t('editTitle')}
          </h3>
          <button
            type="button"
            onClick={() => (isDirty() ? setConfirmDiscard(true) : handleCancel())}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label={t('close')}
            data-testid="transaction-form-close"
          >
            ✕
          </button>
        </div>

        {mode === 'create' && (
          <div
            className="mb-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-700/40"
            data-testid="transaction-form-from-receipt"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {t('fromReceiptHint')}
              </span>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={receiptFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    handleReceiptFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  data-testid="transaction-form-receipt-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={receiptOp.isLoading}
                  onClick={() => receiptFileRef.current?.click()}
                  data-testid="transaction-form-receipt-button"
                >
                  {receiptOp.isLoading ? <ButtonSpinner /> : null}
                  {t('fromReceiptDevice')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={receiptOp.isLoading}
                  aria-expanded={receiptUrlOpen}
                  aria-controls="transaction-form-receipt-url-row"
                  onClick={() => {
                    setReceiptUrlOpen((v) => !v);
                    setTimeout(() => receiptUrlInputRef.current?.focus(), 0);
                  }}
                  data-testid="transaction-form-receipt-url-toggle"
                >
                  {t('fromReceiptUrl')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={receiptOp.isLoading}
                  onClick={() => setManualReceiptOpen(true)}
                  data-testid="transaction-form-receipt-barcodes"
                >
                  {t('fromReceiptBarcodes')}
                </Button>
              </div>
            </div>
            {receiptUrlOpen && (
              <div id="transaction-form-receipt-url-row" className="mt-2 flex gap-2">
                <label htmlFor="transaction-form-receipt-url" className="sr-only">
                  {t('fromReceiptUrlLabel')}
                </label>
                <input
                  id="transaction-form-receipt-url"
                  ref={receiptUrlInputRef}
                  type="url"
                  inputMode="url"
                  value={receiptUrl}
                  onChange={(e) => setReceiptUrl(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter adds the receipt; never submits the transaction form.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleReceiptUrl();
                    }
                  }}
                  placeholder={t('fromReceiptUrlPlaceholder')}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  data-testid="transaction-form-receipt-url-input"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={receiptOp.isLoading || receiptUrl.trim().length === 0}
                  onClick={handleReceiptUrl}
                  data-testid="transaction-form-receipt-url-submit"
                >
                  {receiptOp.isLoading ? <ButtonSpinner /> : null}
                  {t('fromReceiptUrlSubmit')}
                </Button>
              </div>
            )}
            {/* Mounted only while open so its product/receipt hooks (and their
                providers) aren't required by every transaction-form host. */}
            {manualReceiptOpen && (
              <ManualReceiptDialog
                open
                defaultCurrency={user?.defaultCurrency ?? 'USD'}
                categories={categories ?? []}
                onClose={() => setManualReceiptOpen(false)}
                onCreated={(receipt) => {
                  setManualReceiptOpen(false);
                  routeToReview(receipt.id);
                }}
              />
            )}
          </div>
        )}

        {isGeneratedOccurrence && (
          <div
            className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
            role="alert"
            data-testid="transaction-form-occurrence-banner"
          >
            {t('occurrenceNotEditable')}
          </div>
        )}

        {isInitialLoad && (
          <div
            className="mb-3 rounded-md bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-700/40 dark:text-gray-300"
            role="status"
            aria-live="polite"
            data-testid="transaction-form-loading"
          >
            <span className="inline-flex items-center gap-2">
              <ButtonSpinner />
              <span>{t('loading')}</span>
            </span>
          </div>
        )}

        {/* Phase 6 · 6.18.1.4-hotfix — surface a soft warning when the
            edit-mode refetch failed: we fall back to the prop's stale
            copy so the user can still proceed, but they should know the
            data may not reflect concurrent changes. */}
        {mode === 'edit' &&
          !!transaction &&
          !refetchOp.isLoading &&
          refetchedTransaction === null &&
          !!refetchOp.error && (
            <div
              className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              role="alert"
              data-testid="transaction-form-load-error"
            >
              {t('loadError')}
            </div>
          )}

        <form
          aria-busy={isLoading || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            runSave();
          }}
        >
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
                disabled={allInputsDisabled}
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
                disabled={allInputsDisabled}
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
                disabled={allInputsDisabled}
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
                disabled={allInputsDisabled}
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
                type="datetime-local"
                value={state.occurredAt}
                onChange={(e) => setState((s) => ({ ...s, occurredAt: e.target.value }))}
                disabled={allInputsDisabled}
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
                <TransactionCategoryPicker
                  direction={state.direction}
                  value={state.categoryId}
                  onChange={(id) => setState((s) => ({ ...s, categoryId: id }))}
                  categories={categories}
                  disabled={allInputsDisabled}
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
            <TransactionScopeSelector
              value={state.scopes}
              onChange={(next) => setState((s) => ({ ...s, scopes: next }))}
              disabled={allInputsDisabled}
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
                {t('othersCount', { count: nonAccessibleAttributions.length })}{' '}
                {t('othersPreserved')}
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
                disabled={allInputsDisabled}
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
            <TransactionTypeSelector
              value={state.type}
              onChange={(next) => setState((s) => ({ ...s, type: next }))}
              disabled={allInputsDisabled}
              planKindsEnabled={mode === 'create'}
            />
          </div>

          {/* Type-change warning: RECURRING → ONE_TIME tears down the
              schedule server-side (cascade audit). Surface the warning so
              the user is not surprised when they hit Save. */}
          {mode === 'edit' &&
            effectiveTransaction?.type === 'RECURRING' &&
            state.type !== 'RECURRING' && (
              <div
                className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                role="alert"
                data-testid="schedule-type-change-warning"
              >
                {tSchedule('typeChangeWarning')}
              </div>
            )}

          {/* Schedule sub-form — only for type=RECURRING. State is owned
              by the parent so toggling type preserves draft values. */}
          {state.type === 'RECURRING' && (
            <div className="mb-4">
              <TransactionScheduleSubForm
                state={scheduleState}
                errors={scheduleErrors}
                onChange={setScheduleState}
                disabled={allInputsDisabled}
              />
            </div>
          )}

          {/* Plan sub-form (6.20) — create-only for INSTALLMENT / LOAN /
              MORTGAGE; plan parents are read-only in edit mode. */}
          {mode === 'create' && isPlanKind(state.type) && (
            <div className="mb-4">
              <TransactionPlanSubForm
                state={planState}
                errors={planErrors}
                onChange={setPlanState}
                disabled={allInputsDisabled}
              />
            </div>
          )}

          {showBanner && saveOp.error && (
            <div className="mb-3" data-testid="form-api-error">
              <InlineErrorBanner
                reason={saveOp.error.reason}
                httpStatus={saveOp.error.httpStatus}
                message={t('errorGeneric', { message: saveOp.error.message ?? '' })}
                onRetry={() => void saveOp.retry()}
                retrying={isLoading}
                data-testid="form-api-error-banner"
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
              data-testid="form-cancel"
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="flex-1"
              disabled={isLoading || isGeneratedOccurrence}
              aria-busy={isLoading}
              data-testid="form-save"
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

      {/* Phase 6 · 6.18.1.5 — propagation choice for RECURRING-parent edits
          with children. Non-period edits are non-destructive this iteration,
          so `destructive` stays false (the warning block is reserved for the
          period-change regenerate path in 6.18.1.5.2). */}
      <PropagationChoiceDialog
        open={showPropagation}
        destructive={false}
        pending={cascadeOp.isLoading}
        onConfirm={submitWithPropagation}
        onCancel={cancelPropagation}
      />
    </div>
  );
}
