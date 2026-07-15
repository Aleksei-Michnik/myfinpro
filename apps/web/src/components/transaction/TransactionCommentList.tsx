'use client';

// Phase 6 · Iteration 6.14 — cursor-paginated comments thread.
// Phase 6 · Iteration 6.16.4 — every async surface migrated to
// useAsyncOperation:
//   - initial fetch & "Load earlier" use scope='container'
//   - per-comment edit save & soft-delete use scope='control' per row
// Initial-fetch failure → <RetryReturnDialog>. Load-more failure →
// inline retry inside the button (matches TransactionsList).
// 410 Gone on a soft-delete surfaces as a friendly "already removed"
// message and refreshes the list.

import { useTranslations } from 'next-intl';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { InlineLoader } from '@/components/ui/InlineLoader';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { Comment, CommentListResponse } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface TransactionCommentListProps {
  transactionId: string;
  /** Hide edit/delete affordances even on own comments. Default true. */
  allowMutations?: boolean;
  /** Polling interval in ms; 0 disables. Default 0. */
  pollingIntervalMs?: number;
}

export interface TransactionCommentListHandle {
  appendComment(c: Comment): void;
}

const EDITED_THRESHOLD_MS = 5_000;

function formatRelative(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < minute) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  return rtf.format(Math.round(diffMs / day), 'day');
}

function isEdited(c: Comment): boolean {
  const created = new Date(c.createdAt).getTime();
  const updated = new Date(c.updatedAt).getTime();
  return (
    Number.isFinite(created) && Number.isFinite(updated) && updated - created > EDITED_THRESHOLD_MS
  );
}

type LoadMode = 'initial' | 'more';

export const TransactionCommentList = forwardRef<
  TransactionCommentListHandle,
  TransactionCommentListProps
>(function TransactionCommentList(
  { transactionId, allowMutations = true, pollingIntervalMs = 0 },
  ref,
) {
  const t = useTranslations('transactions.comments');
  const tUi = useTranslations('ui.errors');
  const { listComments, editComment, deleteComment } = useTransactions();

  const [items, setItems] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const lastLoadModeRef = useRef<LoadMode>('initial');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Container-scope hook drives both initial fetch and "Load earlier".
  // We use one hook so a new run() on Load-earlier cancels any stale
  // in-flight initial request automatically.
  const listOp = useAsyncOperation<CommentListResponse>({ scope: 'container' });
  // Per-comment control-scope ops; one hook reused across rows.
  const editOp = useAsyncOperation<Comment>({ scope: 'control' });
  const deleteOp = useAsyncOperation<{ ok: true }>({ scope: 'control' });

  // Pin transactionId / cursor for stable callbacks.
  const transactionIdRef = useRef(transactionId);
  transactionIdRef.current = transactionId;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const load = useCallback(
    (mode: LoadMode) => {
      lastLoadModeRef.current = mode;
      return listOp
        .run((signal) =>
          listComments(
            transactionIdRef.current,
            { cursor: mode === 'initial' ? undefined : (cursorRef.current ?? undefined) },
            signal,
          ),
        )
        .then((r) => {
          if (!r) return;
          setItems((prev) => (mode === 'initial' ? r.data : [...r.data, ...prev]));
          setCursor(r.nextCursor);
          setHasMore(r.hasMore);
          setHasLoadedOnce(true);
        });
    },
    [listOp, listComments],
  );

  // Initial load on transactionId change — guarded so it doesn't re-fire on
  // listOp identity churn.
  const lastTransactionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastTransactionIdRef.current === transactionId) return;
    lastTransactionIdRef.current = transactionId;
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setHasLoadedOnce(false);
    void load('initial');
  }, [transactionId, load]);

  // Polling: refetch first page at interval (unaffected by error/loading).
  useEffect(() => {
    if (!pollingIntervalMs || pollingIntervalMs <= 0) return;
    const id = setInterval(() => {
      void load('initial');
    }, pollingIntervalMs);
    return () => clearInterval(id);
  }, [pollingIntervalMs, load]);

  useImperativeHandle(
    ref,
    () => ({
      appendComment(c: Comment) {
        setItems((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
      },
    }),
    [],
  );

  // ── Realtime sync (Phase 6 · Iteration 6.18.1.4.2) ──────────────────
  //
  // Subscribe to the three comment events scoped to this transaction. The
  // wire `CommentResponse` is structurally compatible with the local
  // `Comment` type except `deletedAt` is optional on the wire; we
  // normalise to `null` on ingest so downstream filtering / rendering
  // can treat the field as required.
  //
  // Idempotency: every handler dedupes by `commentId`. The author who
  // produced the mutation already has the row locally (added by the
  // optimistic create / save flow), so the realtime echo would
  // otherwise create a duplicate. Reconnect-time replay of buffered
  // events is also covered by the same dedupe.
  useRealtimeEvents({ type: 'comment.created', transactionId }, (event) => {
    const incoming: Comment = {
      ...event.comment,
      deletedAt: event.comment.deletedAt ?? null,
    };
    setItems((prev) => (prev.some((x) => x.id === incoming.id) ? prev : [...prev, incoming]));
  });

  useRealtimeEvents({ type: 'comment.updated', transactionId }, (event) => {
    const incoming: Comment = {
      ...event.comment,
      deletedAt: event.comment.deletedAt ?? null,
    };
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === incoming.id);
      if (idx === -1) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], ...incoming };
      return next;
    });
  });

  useRealtimeEvents({ type: 'comment.deleted', transactionId }, (event) => {
    // Match the optimistic-delete path in confirmDelete(): drop the
    // row entirely. Soft-deleted rows that arrive via the initial
    // fetch are also filtered out below in `visible`, keeping the two
    // ingestion paths consistent.
    setItems((prev) => prev.filter((x) => x.id !== event.commentId));
  });

  // Phase 6 · 6.18.1.4-hotfix (part 2) — gap recovery. Refetch the
  // first page on every realtime reconnect-after-gap. The 'initial'
  // load replaces `items` with server truth, so any comment events
  // missed during the gap (added/edited/deleted in another tab) are
  // reconciled in one round-trip.
  useRealtimeResync(() => {
    void load('initial');
  });

  const beginEdit = (c: Comment) => {
    setEditingId(c.id);
    setEditValue(c.content);
    setEditError(null);
    editOp.reset();
  };

  const cancelEdit = () => {
    // Aborts an in-flight save if the user cancels mid-flight.
    editOp.cancel();
    setEditingId(null);
    setEditValue('');
    setEditError(null);
  };

  const saveEdit = (c: Comment) => {
    const trimmed = editValue.trim();
    if (trimmed.length === 0) {
      setEditError(t('validation.tooShort'));
      return;
    }
    if (trimmed.length > 2000) {
      setEditError(t('validation.tooLong'));
      return;
    }
    setEditError(null);
    void editOp
      .run((signal) => editComment(transactionId, c.id, trimmed, signal))
      .then((updated) => {
        if (!updated) return;
        setItems((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
        setEditingId(null);
        setEditValue('');
      });
  };

  const beginConfirmDelete = (id: string) => {
    setConfirmDeleteId(id);
    setDeleteError(null);
    deleteOp.reset();
  };

  const cancelConfirmDelete = () => {
    deleteOp.cancel();
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  const confirmDelete = (c: Comment) => {
    setDeletingId(c.id);
    setDeleteError(null);
    void deleteOp
      .run(async (signal) => {
        await deleteComment(transactionId, c.id, signal);
        return { ok: true } as const;
      })
      .then((res) => {
        // res is undefined on error / abort; skip optimistic removal.
        if (!res) return;
        setItems((prev) => prev.filter((x) => x.id !== c.id));
        setConfirmDeleteId(null);
      })
      .finally(() => setDeletingId(null));
  };

  // Map a delete-op error to UI state (special-case 410 Gone).
  const deleteIsError = deleteOp.isError;
  const deleteErrorInfo = deleteOp.error;
  useEffect(() => {
    if (!deleteIsError || !deleteErrorInfo) return;
    if (deleteErrorInfo.httpStatus === 410) {
      // Already deleted on the server — friendly message + refresh list.
      setDeleteError(t('alreadyRemoved'));
      if (confirmDeleteId) {
        setItems((prev) => prev.filter((x) => x.id !== confirmDeleteId));
      }
      setConfirmDeleteId(null);
      void load('initial');
    } else {
      setDeleteError(
        t('errorDelete', {
          message: deleteErrorInfo.message ?? deleteErrorInfo.reason,
        }),
      );
    }
  }, [deleteIsError, deleteErrorInfo, confirmDeleteId, load, t]);

  // Map an edit-op error to UI inline message under the textarea.
  const editIsError = editOp.isError;
  const editErrorInfo = editOp.error;
  useEffect(() => {
    if (!editIsError || !editErrorInfo) return;
    setEditError(t('errorEdit', { message: editErrorInfo.message ?? editErrorInfo.reason }));
  }, [editIsError, editErrorInfo, t]);

  const visible = items.filter((c) => c.deletedAt === null);
  const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';

  const initialError =
    listOp.isError && lastLoadModeRef.current === 'initial' && !hasLoadedOnce ? listOp.error : null;
  const loadMoreError = listOp.isError && lastLoadModeRef.current === 'more' ? listOp.error : null;
  const isInitialLoading =
    listOp.isLoading && lastLoadModeRef.current === 'initial' && !hasLoadedOnce;
  const isLoadingMore = listOp.isLoading && lastLoadModeRef.current === 'more';

  return (
    <div className="relative space-y-3" data-testid="transaction-comment-list" aria-live="polite">
      {hasMore && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void load('more')}
            disabled={listOp.isLoading}
            aria-busy={isLoadingMore}
            data-testid="comment-load-earlier"
          >
            {isLoadingMore ? <InlineLoader label={t('loadingMore')} /> : t('loadEarlier')}
          </Button>
        </div>
      )}

      {loadMoreError && (
        <div
          className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300"
          role="alert"
          data-testid="comment-load-more-error"
        >
          {t('errorLoading', { message: loadMoreError.message ?? '' })}{' '}
          <button
            type="button"
            onClick={() => void load('more')}
            className="font-medium underline"
            data-testid="comment-load-more-retry"
          >
            {tUi('retry')}
          </button>
        </div>
      )}

      {isInitialLoading && (
        <div
          className="py-4 text-center text-sm text-gray-500 dark:text-gray-400"
          data-testid="comment-list-loading"
          role="status"
        >
          {t('loading')}
        </div>
      )}

      {!listOp.isLoading && !listOp.isError && visible.length === 0 && hasLoadedOnce && (
        <p
          className="py-4 text-center text-sm text-gray-500 dark:text-gray-400"
          data-testid="comment-list-empty"
        >
          {t('empty')}
        </p>
      )}

      <ul className="space-y-3">
        {visible.map((c) => {
          const editing = editingId === c.id;
          const confirming = confirmDeleteId === c.id;
          const savingThisRow = editing && editOp.isLoading;
          const deletingThisRow = deletingId === c.id && deleteOp.isLoading;
          return (
            <li
              key={c.id}
              className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
              data-testid={`comment-row-${c.id}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span data-testid={`comment-author-${c.id}`}>{c.author.name}</span>
                <span>
                  <span data-testid={`comment-time-${c.id}`}>
                    {formatRelative(c.createdAt, locale)}
                  </span>
                  {isEdited(c) && (
                    <span
                      className="ms-2 italic"
                      data-testid={`comment-edited-${c.id}`}
                      title={t('edited')}
                    >
                      ({t('edited')})
                    </span>
                  )}
                </span>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    disabled={savingThisRow}
                    data-testid={`comment-edit-textarea-${c.id}`}
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                  {editError && (
                    <p className="text-xs text-red-600" role="alert">
                      {editError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => saveEdit(c)}
                      disabled={savingThisRow}
                      aria-busy={savingThisRow}
                      data-testid={`comment-edit-save-${c.id}`}
                    >
                      {savingThisRow ? (
                        <span className="inline-flex items-center gap-2">
                          <ButtonSpinner />
                          <span>{t('save')}</span>
                        </span>
                      ) : (
                        t('save')
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={cancelEdit}
                      data-testid={`comment-edit-cancel-${c.id}`}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p
                  className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200"
                  data-testid={`comment-content-${c.id}`}
                >
                  {c.content}
                </p>
              )}

              {!editing && allowMutations && c.isMine && !confirming && (
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => beginEdit(c)}
                    className="text-primary-700 hover:underline dark:text-primary-300"
                    data-testid={`comment-edit-${c.id}`}
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => beginConfirmDelete(c.id)}
                    className="text-red-700 hover:underline dark:text-red-300"
                    data-testid={`comment-delete-${c.id}`}
                  >
                    {t('delete')}
                  </button>
                </div>
              )}

              {confirming && (
                <div
                  className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                  role="alert"
                  data-testid={`comment-confirm-${c.id}`}
                >
                  <p className="mb-2">{t('confirmDelete')}</p>
                  {deleteError && (
                    <p className="mb-2 text-red-700 dark:text-red-300">{deleteError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="!bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
                      onClick={() => confirmDelete(c)}
                      disabled={deletingThisRow}
                      aria-busy={deletingThisRow}
                      data-testid={`comment-confirm-delete-${c.id}`}
                    >
                      {deletingThisRow ? (
                        <span className="inline-flex items-center gap-2">
                          <ButtonSpinner />
                          <span>{t('deleteConfirm')}</span>
                        </span>
                      ) : (
                        t('deleteConfirm')
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={cancelConfirmDelete}
                      data-testid={`comment-confirm-cancel-${c.id}`}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <LoadingOverlay active={isInitialLoading} data-testid="comment-list-overlay" />

      <RetryReturnDialog
        open={!!initialError}
        reason={initialError?.reason ?? 'unknown'}
        httpStatus={initialError?.httpStatus}
        onRetry={() => void load('initial')}
        onReturn={() => listOp.cancel()}
      />
    </div>
  );
});
