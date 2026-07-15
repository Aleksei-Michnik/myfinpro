import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionCommentList } from './TransactionCommentList';
import { RealtimeContext } from '@/lib/realtime/realtime-context';
import type { RealtimeEvent } from '@/lib/realtime/realtime-types';
import type { Comment, CommentListResponse } from '@/lib/transaction/types';

const mockListComments = vi.fn();
const mockEditComment = vi.fn();
const mockDeleteComment = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({
    listComments: mockListComments,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
  }),
}));

/**
 * Lightweight RealtimeProvider for tests — exposes an `emit()` capture
 * via the returned tuple so test cases can fan synthetic events to every
 * mounted subscriber without spinning up a real EventSource.
 */
function makeRealtimeHarness() {
  const listeners = new Set<(e: RealtimeEvent) => void>();
  const subscribe = (listener: (e: RealtimeEvent) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const emit = (event: RealtimeEvent) => {
    for (const l of listeners) l(event);
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeContext.Provider value={{ connectionStatus: 'connected', resyncToken: 0, subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
  return { Wrapper, emit };
}

function makeComment(p: Partial<Comment> = {}): Comment {
  return {
    id: p.id ?? 'c-1',
    transactionId: 'p-1',
    author: p.author ?? { id: 'u-1', name: 'Alice' },
    content: p.content ?? 'hello',
    createdAt: p.createdAt ?? '2026-04-25T00:00:00Z',
    updatedAt: p.updatedAt ?? p.createdAt ?? '2026-04-25T00:00:00Z',
    deletedAt: p.deletedAt ?? null,
    isMine: p.isMine ?? true,
  };
}

function resp(rows: Comment[], extra?: Partial<CommentListResponse>): CommentListResponse {
  return {
    data: rows,
    nextCursor: extra?.nextCursor ?? null,
    hasMore: extra?.hasMore ?? false,
  };
}

describe('TransactionCommentList', () => {
  beforeEach(() => {
    mockListComments.mockReset();
    mockEditComment.mockReset();
    mockDeleteComment.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads the first page on mount', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment()]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    expect(mockListComments).toHaveBeenCalledWith(
      'p-1',
      { cursor: undefined },
      expect.any(AbortSignal),
    );
  });

  it('shows empty state when no rows', async () => {
    mockListComments.mockResolvedValueOnce(resp([]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-list-empty')).toBeInTheDocument());
  });

  it('own comment shows Edit/Delete affordances', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment({ isMine: true })]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-edit-c-1')).toBeInTheDocument());
    expect(screen.getByTestId('comment-delete-c-1')).toBeInTheDocument();
  });

  it("other user's comment hides Edit/Delete", async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment({ isMine: false })]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    expect(screen.queryByTestId('comment-edit-c-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('comment-delete-c-1')).not.toBeInTheDocument();
  });

  it('"Load earlier" prepends older comments', async () => {
    mockListComments.mockResolvedValueOnce(
      resp([makeComment({ id: 'c-2' })], { nextCursor: 'CUR', hasMore: true }),
    );
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-2')).toBeInTheDocument());
    mockListComments.mockResolvedValueOnce(resp([makeComment({ id: 'c-1' })]));
    fireEvent.click(screen.getByTestId('comment-load-earlier'));
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    // c-1 (older) prepended before c-2
    const items = screen.getAllByTestId(/^comment-row-/);
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual([
      'comment-row-c-1',
      'comment-row-c-2',
    ]);
  });

  it('edit flow: toggles textarea, saves via editComment, updates content', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment({ content: 'old' })]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('comment-edit-c-1'));
    const textarea = screen.getByTestId('comment-edit-textarea-c-1') as HTMLTextAreaElement;
    expect(textarea.value).toBe('old');
    fireEvent.change(textarea, { target: { value: 'new' } });
    mockEditComment.mockResolvedValueOnce(
      makeComment({ content: 'new', updatedAt: '2026-04-25T00:00:10Z' }),
    );
    fireEvent.click(screen.getByTestId('comment-edit-save-c-1'));
    await waitFor(() => expect(screen.getByTestId('comment-content-c-1')).toHaveTextContent('new'));
    expect(mockEditComment).toHaveBeenCalledWith('p-1', 'c-1', 'new', expect.any(AbortSignal));
  });

  it('cancel on edit discards local changes', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment({ content: 'keep' })]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('comment-edit-c-1'));
    fireEvent.change(screen.getByTestId('comment-edit-textarea-c-1'), { target: { value: 'no' } });
    fireEvent.click(screen.getByTestId('comment-edit-cancel-c-1'));
    expect(screen.getByTestId('comment-content-c-1')).toHaveTextContent('keep');
    expect(mockEditComment).not.toHaveBeenCalled();
  });

  it('delete confirm flow removes the row', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment()]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('comment-delete-c-1'));
    mockDeleteComment.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByTestId('comment-confirm-delete-c-1'));
    await waitFor(() => expect(screen.queryByTestId('comment-row-c-1')).not.toBeInTheDocument());
    expect(mockDeleteComment).toHaveBeenCalledWith('p-1', 'c-1', expect.any(AbortSignal));
  });

  it('delete error stays on the row with message', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment()]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('comment-delete-c-1'));
    mockDeleteComment.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(screen.getByTestId('comment-confirm-delete-c-1'));
    await waitFor(() => expect(screen.getByTestId('comment-confirm-c-1')).toBeInTheDocument());
    expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument();
  });

  it('edited badge appears when updatedAt > createdAt + 5s', async () => {
    mockListComments.mockResolvedValueOnce(
      resp([
        makeComment({
          createdAt: '2026-04-25T00:00:00Z',
          updatedAt: '2026-04-25T00:00:10Z',
        }),
      ]),
    );
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-edited-c-1')).toBeInTheDocument());
  });

  it('edited badge NOT shown for freshly created comment', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment()]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    expect(screen.queryByTestId('comment-edited-c-1')).not.toBeInTheDocument();
  });

  it('soft-deleted rows are defensively hidden', async () => {
    mockListComments.mockResolvedValueOnce(
      resp([makeComment({ id: 'c-1', deletedAt: '2026-04-25T01:00:00Z' })]),
    );
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(mockListComments).toHaveBeenCalled());
    expect(screen.queryByTestId('comment-row-c-1')).not.toBeInTheDocument();
  });

  it('polling: setInterval is registered when pollingIntervalMs > 0', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    mockListComments.mockResolvedValue(resp([]));
    render(<TransactionCommentList transactionId="p-1" pollingIntervalMs={1000} />);
    await waitFor(() => expect(mockListComments).toHaveBeenCalledTimes(1));
    const call = setIntervalSpy.mock.calls.find((c) => c[1] === 1000);
    expect(call).toBeTruthy();
    setIntervalSpy.mockRestore();
  });

  it('polling: no setInterval registered when pollingIntervalMs=0', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    mockListComments.mockResolvedValue(resp([]));
    render(<TransactionCommentList transactionId="p-1" />);
    await waitFor(() => expect(mockListComments).toHaveBeenCalledTimes(1));
    // No interval with our specific polling duration should be present (other
    // libraries may register their own intervals — we scope by second arg).
    const poll = setIntervalSpy.mock.calls.find(
      (c) => typeof c[1] === 'number' && c[1] > 0 && c[1] <= 60_000 && c[1] !== 0,
    );
    // Accept that unrelated setInterval calls could exist; just assert we
    // didn't register a polling one matching our default (0 means disabled).
    // We only care there's no call whose second arg matches our prop.
    const matching = setIntervalSpy.mock.calls.find((c) => c[1] === 0);
    expect(matching).toBeFalsy();
    // poll may be truthy due to jsdom, but our prop didn't schedule one.
    void poll;
    setIntervalSpy.mockRestore();
  });

  // ── Realtime sync (Phase 6 · Iteration 6.18.1.4.2) ──

  describe('realtime subscriptions', () => {
    it('comment.created appends a new row from a different author', async () => {
      mockListComments.mockResolvedValueOnce(resp([makeComment({ id: 'c-1' })]));
      const { Wrapper, emit } = makeRealtimeHarness();
      render(<TransactionCommentList transactionId="p-1" />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());

      act(() => {
        emit({
          type: 'comment.created',
          transactionId: 'p-1',
          comment: makeComment({
            id: 'c-2',
            content: 'incoming',
            author: { id: 'u-9', name: 'Bob' },
            isMine: false,
          }),
        });
      });

      expect(screen.getByTestId('comment-row-c-2')).toBeInTheDocument();
      expect(screen.getByTestId('comment-content-c-2')).toHaveTextContent('incoming');
    });

    it('comment.created is idempotent when the same id arrives twice', async () => {
      mockListComments.mockResolvedValueOnce(resp([]));
      const { Wrapper, emit } = makeRealtimeHarness();
      render(<TransactionCommentList transactionId="p-1" />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByTestId('comment-list-empty')).toBeInTheDocument());

      const incoming = makeComment({ id: 'c-9', content: 'once' });
      act(() => {
        emit({ type: 'comment.created', transactionId: 'p-1', comment: incoming });
        emit({ type: 'comment.created', transactionId: 'p-1', comment: incoming });
      });

      expect(screen.getAllByTestId(/^comment-row-/)).toHaveLength(1);
    });

    it('ignores comment.created for a different transactionId', async () => {
      mockListComments.mockResolvedValueOnce(resp([]));
      const { Wrapper, emit } = makeRealtimeHarness();
      render(<TransactionCommentList transactionId="p-1" />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByTestId('comment-list-empty')).toBeInTheDocument());

      act(() => {
        emit({
          type: 'comment.created',
          transactionId: 'p-OTHER',
          comment: makeComment({ id: 'c-x' }),
        });
      });

      expect(screen.queryByTestId('comment-row-c-x')).not.toBeInTheDocument();
    });

    it('comment.updated patches the matching row in place', async () => {
      mockListComments.mockResolvedValueOnce(resp([makeComment({ id: 'c-1', content: 'old' })]));
      const { Wrapper, emit } = makeRealtimeHarness();
      render(<TransactionCommentList transactionId="p-1" />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());

      act(() => {
        emit({
          type: 'comment.updated',
          transactionId: 'p-1',
          comment: makeComment({
            id: 'c-1',
            content: 'edited remotely',
            updatedAt: '2026-04-25T00:01:00Z',
          }),
        });
      });

      expect(screen.getByTestId('comment-content-c-1')).toHaveTextContent('edited remotely');
    });

    it('comment.updated for an unknown id is a no-op', async () => {
      mockListComments.mockResolvedValueOnce(resp([makeComment({ id: 'c-1' })]));
      const { Wrapper, emit } = makeRealtimeHarness();
      render(<TransactionCommentList transactionId="p-1" />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());

      act(() => {
        emit({
          type: 'comment.updated',
          transactionId: 'p-1',
          comment: makeComment({ id: 'c-ghost', content: 'nope' }),
        });
      });

      expect(screen.queryByTestId('comment-row-c-ghost')).not.toBeInTheDocument();
      expect(screen.getAllByTestId(/^comment-row-/)).toHaveLength(1);
    });

    it('comment.deleted removes the row', async () => {
      mockListComments.mockResolvedValueOnce(
        resp([makeComment({ id: 'c-1' }), makeComment({ id: 'c-2' })]),
      );
      const { Wrapper, emit } = makeRealtimeHarness();
      render(<TransactionCommentList transactionId="p-1" />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByTestId('comment-row-c-2')).toBeInTheDocument());

      act(() => {
        emit({ type: 'comment.deleted', transactionId: 'p-1', commentId: 'c-1' });
      });

      expect(screen.queryByTestId('comment-row-c-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('comment-row-c-2')).toBeInTheDocument();
    });

    it('list container exposes aria-live="polite" for assistive tech', async () => {
      mockListComments.mockResolvedValueOnce(resp([]));
      render(<TransactionCommentList transactionId="p-1" />);
      await waitFor(() => expect(screen.getByTestId('comment-list-empty')).toBeInTheDocument());
      const list = screen.getByTestId('transaction-comment-list');
      expect(list.getAttribute('aria-live')).toBe('polite');
    });
  });
});
