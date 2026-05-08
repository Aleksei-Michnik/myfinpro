'use client';

// Phase 6 · Iteration 6.14 — cursor-paginated comments thread.
// Oldest → newest; "Load earlier comments" prepends older entries.
// Exposes an imperative `appendComment` handle so the input box (owned by
// the parent page) can push the newly posted comment into the bottom of
// the list without triggering a refetch.

import { useTranslations } from 'next-intl';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { usePayments } from '@/lib/payment/payment-context';
import type { Comment } from '@/lib/payment/types';

export interface PaymentCommentListProps {
  paymentId: string;
  /** Hide edit/delete affordances even on own comments. Default true. */
  allowMutations?: boolean;
  /** Polling interval in ms; 0 disables. Default 0. */
  pollingIntervalMs?: number;
}

export interface PaymentCommentListHandle {
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

export const PaymentCommentList = forwardRef<PaymentCommentListHandle, PaymentCommentListProps>(
  function PaymentCommentList({ paymentId, allowMutations = true, pollingIntervalMs = 0 }, ref) {
    const t = useTranslations('payments.comments');
    const { listComments, editComment, deleteComment } = usePayments();

    const [items, setItems] = useState<Comment[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [firstLoad, setFirstLoad] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [editError, setEditError] = useState<string | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Pin these for stable effect deps.
    const paymentIdRef = useRef(paymentId);
    paymentIdRef.current = paymentId;
    const cursorRef = useRef(cursor);
    cursorRef.current = cursor;

    const load = useCallback(
      async (reset: boolean) => {
        setLoading(true);
        setError(null);
        try {
          const r = await listComments(paymentIdRef.current, {
            cursor: reset ? undefined : (cursorRef.current ?? undefined),
          });
          setItems((prev) => (reset ? r.data : [...r.data, ...prev]));
          setCursor(r.nextCursor);
          setHasMore(r.hasMore);
        } catch (e) {
          setError((e as Error).message || 'Failed to load comments');
        } finally {
          setLoading(false);
          setFirstLoad(false);
        }
      },
      [listComments],
    );

    useEffect(() => {
      setItems([]);
      setCursor(null);
      setHasMore(false);
      setFirstLoad(true);
      void load(true);
    }, [paymentId, load]);

    // Polling: refetch first page at interval.
    useEffect(() => {
      if (!pollingIntervalMs || pollingIntervalMs <= 0) return;
      const id = setInterval(() => {
        void load(true);
      }, pollingIntervalMs);
      return () => clearInterval(id);
    }, [pollingIntervalMs, load]);

    useImperativeHandle(
      ref,
      () => ({
        appendComment(c: Comment) {
          setItems((prev) => [...prev, c]);
        },
      }),
      [],
    );

    const beginEdit = (c: Comment) => {
      setEditingId(c.id);
      setEditValue(c.content);
      setEditError(null);
    };

    const cancelEdit = () => {
      setEditingId(null);
      setEditValue('');
      setEditError(null);
    };

    const saveEdit = async (c: Comment) => {
      const trimmed = editValue.trim();
      if (trimmed.length === 0) {
        setEditError(t('validation.tooShort'));
        return;
      }
      if (trimmed.length > 2000) {
        setEditError(t('validation.tooLong'));
        return;
      }
      setSavingEdit(true);
      try {
        const updated = await editComment(paymentId, c.id, trimmed);
        setItems((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
        cancelEdit();
      } catch (e) {
        setEditError(t('errorEdit', { message: (e as Error).message || '' }));
      } finally {
        setSavingEdit(false);
      }
    };

    const confirmDelete = async (c: Comment) => {
      setDeletingId(c.id);
      setDeleteError(null);
      try {
        await deleteComment(paymentId, c.id);
        setItems((prev) => prev.filter((x) => x.id !== c.id));
        setConfirmDeleteId(null);
      } catch (e) {
        setDeleteError(t('errorDelete', { message: (e as Error).message || '' }));
      } finally {
        setDeletingId(null);
      }
    };

    const visible = items.filter((c) => c.deletedAt === null);
    const locale =
      typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';

    return (
      <div className="space-y-3" data-testid="payment-comment-list" aria-live="polite">
        {hasMore && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void load(false)}
              disabled={loading}
              data-testid="comment-load-earlier"
            >
              {loading ? t('loadingMore') : t('loadEarlier')}
            </Button>
          </div>
        )}

        {firstLoad && loading && (
          <div
            className="py-4 text-center text-sm text-gray-500 dark:text-gray-400"
            data-testid="comment-list-loading"
            role="status"
          >
            {t('loading')}
          </div>
        )}

        {error && (
          <div
            className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
            role="alert"
            data-testid="comment-list-error"
          >
            {t('errorLoading', { message: error })}
          </div>
        )}

        {!loading && !error && visible.length === 0 && !firstLoad && (
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
                        onClick={() => void saveEdit(c)}
                        disabled={savingEdit}
                        data-testid={`comment-edit-save-${c.id}`}
                      >
                        {t('save')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={cancelEdit}
                        disabled={savingEdit}
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
                      onClick={() => {
                        setConfirmDeleteId(c.id);
                        setDeleteError(null);
                      }}
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
                        onClick={() => void confirmDelete(c)}
                        disabled={deletingId === c.id}
                        data-testid={`comment-confirm-delete-${c.id}`}
                      >
                        {deletingId === c.id ? t('deleting') : t('deleteConfirm')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setDeleteError(null);
                        }}
                        disabled={deletingId === c.id}
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
      </div>
    );
  },
);
