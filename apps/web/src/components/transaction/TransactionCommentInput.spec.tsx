import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionCommentInput } from './TransactionCommentInput';
import type { Comment } from '@/lib/transaction/types';

const mockPostComment = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values && 'message' in values ? `${key}:${values.message}` : key,
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ postComment: mockPostComment }),
}));

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    transactionId: 'p-1',
    author: { id: 'u-1', name: 'Alice' },
    content: 'hello',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    deletedAt: null,
    isMine: true,
    ...overrides,
  };
}

describe('TransactionCommentInput', () => {
  beforeEach(() => {
    mockPostComment.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows validation error for empty content', () => {
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    expect(screen.getByTestId('comment-input-error')).toHaveTextContent('validation.tooShort');
    expect(mockPostComment).not.toHaveBeenCalled();
  });

  it('shows validation error for content > 2000 chars', () => {
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} />);
    const textarea = screen.getByTestId('comment-input-textarea') as HTMLTextAreaElement;
    // Bypass maxLength by setting value via fireEvent.
    const long = 'a'.repeat(2001);
    fireEvent.change(textarea, { target: { value: long } });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    expect(screen.getByTestId('comment-input-error')).toHaveTextContent('validation.tooLong');
    expect(mockPostComment).not.toHaveBeenCalled();
  });

  it('calls postComment with the trimmed content', async () => {
    mockPostComment.mockResolvedValueOnce(makeComment());
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} />);
    fireEvent.change(screen.getByTestId('comment-input-textarea'), {
      target: { value: '  hi  ' },
    });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() =>
      expect(mockPostComment).toHaveBeenCalledWith('p-1', 'hi', expect.any(AbortSignal)),
    );
  });

  it('fires onPosted with the returned comment', async () => {
    const c = makeComment({ content: 'new' });
    mockPostComment.mockResolvedValueOnce(c);
    const onPosted = vi.fn();
    render(<TransactionCommentInput transactionId="p-1" onPosted={onPosted} />);
    fireEvent.change(screen.getByTestId('comment-input-textarea'), {
      target: { value: 'new' },
    });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith(c));
  });

  it('clears the textarea after successful post', async () => {
    mockPostComment.mockResolvedValueOnce(makeComment());
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} />);
    const textarea = screen.getByTestId('comment-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'ok' } });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('preserves the textarea on error and shows inline message', async () => {
    mockPostComment.mockRejectedValueOnce(new Error('boom'));
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} />);
    const textarea = screen.getByTestId('comment-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'keepme' } });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    // Network errors now surface in the inline error banner (control-scope).
    await waitFor(() => expect(screen.getByTestId('comment-input-banner')).toBeInTheDocument());
    expect(screen.getByTestId('comment-input-banner-retry')).toBeInTheDocument();
    expect(textarea.value).toBe('keepme');
  });

  it('clicking Retry on the banner re-runs the post and clears on success', async () => {
    mockPostComment.mockRejectedValueOnce(new Error('boom'));
    mockPostComment.mockResolvedValueOnce(makeComment());
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} />);
    fireEvent.change(screen.getByTestId('comment-input-textarea'), {
      target: { value: 'keepme' },
    });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(screen.getByTestId('comment-input-banner')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('comment-input-banner-retry'));
    await waitFor(() =>
      expect(screen.queryByTestId('comment-input-banner')).not.toBeInTheDocument(),
    );
    expect(mockPostComment).toHaveBeenCalledTimes(2);
  });

  it('aria-busy=true on root + textarea/submit disabled while posting', async () => {
    let resolveFn: (c: Comment) => void = () => {};
    mockPostComment.mockImplementationOnce(
      () => new Promise<Comment>((resolve) => (resolveFn = resolve)),
    );
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} />);
    fireEvent.change(screen.getByTestId('comment-input-textarea'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => {
      const root = screen.getByTestId('transaction-comment-input');
      expect(root.getAttribute('aria-busy')).toBe('true');
    });
    expect(screen.getByTestId('comment-input-textarea')).toBeDisabled();
    expect(screen.getByTestId('comment-input-submit')).toBeDisabled();
    resolveFn(makeComment());
  });

  it('submit button is disabled when the disabled prop is true', () => {
    render(<TransactionCommentInput transactionId="p-1" onPosted={vi.fn()} disabled />);
    expect(screen.getByTestId('comment-input-submit')).toBeDisabled();
    expect(screen.getByTestId('comment-input-textarea')).toBeDisabled();
  });
});
