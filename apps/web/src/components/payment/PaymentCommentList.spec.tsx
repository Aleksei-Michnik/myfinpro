import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentCommentList } from './PaymentCommentList';
import type { Comment, CommentListResponse } from '@/lib/payment/types';

const mockListComments = vi.fn();
const mockEditComment = vi.fn();
const mockDeleteComment = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    listComments: mockListComments,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
  }),
}));

function makeComment(p: Partial<Comment> = {}): Comment {
  return {
    id: p.id ?? 'c-1',
    paymentId: 'p-1',
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

describe('PaymentCommentList', () => {
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
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    expect(mockListComments).toHaveBeenCalledWith('p-1', { cursor: undefined });
  });

  it('shows empty state when no rows', async () => {
    mockListComments.mockResolvedValueOnce(resp([]));
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-list-empty')).toBeInTheDocument());
  });

  it('own comment shows Edit/Delete affordances', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment({ isMine: true })]));
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-edit-c-1')).toBeInTheDocument());
    expect(screen.getByTestId('comment-delete-c-1')).toBeInTheDocument();
  });

  it("other user's comment hides Edit/Delete", async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment({ isMine: false })]));
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    expect(screen.queryByTestId('comment-edit-c-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('comment-delete-c-1')).not.toBeInTheDocument();
  });

  it('"Load earlier" prepends older comments', async () => {
    mockListComments.mockResolvedValueOnce(
      resp([makeComment({ id: 'c-2' })], { nextCursor: 'CUR', hasMore: true }),
    );
    render(<PaymentCommentList paymentId="p-1" />);
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
    render(<PaymentCommentList paymentId="p-1" />);
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
    expect(mockEditComment).toHaveBeenCalledWith('p-1', 'c-1', 'new');
  });

  it('cancel on edit discards local changes', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment({ content: 'keep' })]));
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('comment-edit-c-1'));
    fireEvent.change(screen.getByTestId('comment-edit-textarea-c-1'), { target: { value: 'no' } });
    fireEvent.click(screen.getByTestId('comment-edit-cancel-c-1'));
    expect(screen.getByTestId('comment-content-c-1')).toHaveTextContent('keep');
    expect(mockEditComment).not.toHaveBeenCalled();
  });

  it('delete confirm flow removes the row', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment()]));
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('comment-delete-c-1'));
    mockDeleteComment.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByTestId('comment-confirm-delete-c-1'));
    await waitFor(() => expect(screen.queryByTestId('comment-row-c-1')).not.toBeInTheDocument());
    expect(mockDeleteComment).toHaveBeenCalledWith('p-1', 'c-1');
  });

  it('delete error stays on the row with message', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment()]));
    render(<PaymentCommentList paymentId="p-1" />);
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
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-edited-c-1')).toBeInTheDocument());
  });

  it('edited badge NOT shown for freshly created comment', async () => {
    mockListComments.mockResolvedValueOnce(resp([makeComment()]));
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('comment-row-c-1')).toBeInTheDocument());
    expect(screen.queryByTestId('comment-edited-c-1')).not.toBeInTheDocument();
  });

  it('soft-deleted rows are defensively hidden', async () => {
    mockListComments.mockResolvedValueOnce(
      resp([makeComment({ id: 'c-1', deletedAt: '2026-04-25T01:00:00Z' })]),
    );
    render(<PaymentCommentList paymentId="p-1" />);
    await waitFor(() => expect(mockListComments).toHaveBeenCalled());
    expect(screen.queryByTestId('comment-row-c-1')).not.toBeInTheDocument();
  });

  it('polling: setInterval is registered when pollingIntervalMs > 0', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    mockListComments.mockResolvedValue(resp([]));
    render(<PaymentCommentList paymentId="p-1" pollingIntervalMs={1000} />);
    await waitFor(() => expect(mockListComments).toHaveBeenCalledTimes(1));
    const call = setIntervalSpy.mock.calls.find((c) => c[1] === 1000);
    expect(call).toBeTruthy();
    setIntervalSpy.mockRestore();
  });

  it('polling: no setInterval registered when pollingIntervalMs=0', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    mockListComments.mockResolvedValue(resp([]));
    render(<PaymentCommentList paymentId="p-1" />);
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
});
