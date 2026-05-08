import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentCommentInput } from './PaymentCommentInput';
import type { Comment } from '@/lib/payment/types';

const mockPostComment = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values && 'message' in values ? `${key}:${values.message}` : key,
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({ postComment: mockPostComment }),
}));

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    paymentId: 'p-1',
    author: { id: 'u-1', name: 'Alice' },
    content: 'hello',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    deletedAt: null,
    isMine: true,
    ...overrides,
  };
}

describe('PaymentCommentInput', () => {
  beforeEach(() => {
    mockPostComment.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows validation error for empty content', () => {
    render(<PaymentCommentInput paymentId="p-1" onPosted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    expect(screen.getByTestId('comment-input-error')).toHaveTextContent('validation.tooShort');
    expect(mockPostComment).not.toHaveBeenCalled();
  });

  it('shows validation error for content > 2000 chars', () => {
    render(<PaymentCommentInput paymentId="p-1" onPosted={vi.fn()} />);
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
    render(<PaymentCommentInput paymentId="p-1" onPosted={vi.fn()} />);
    fireEvent.change(screen.getByTestId('comment-input-textarea'), {
      target: { value: '  hi  ' },
    });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(mockPostComment).toHaveBeenCalledWith('p-1', 'hi'));
  });

  it('fires onPosted with the returned comment', async () => {
    const c = makeComment({ content: 'new' });
    mockPostComment.mockResolvedValueOnce(c);
    const onPosted = vi.fn();
    render(<PaymentCommentInput paymentId="p-1" onPosted={onPosted} />);
    fireEvent.change(screen.getByTestId('comment-input-textarea'), {
      target: { value: 'new' },
    });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith(c));
  });

  it('clears the textarea after successful post', async () => {
    mockPostComment.mockResolvedValueOnce(makeComment());
    render(<PaymentCommentInput paymentId="p-1" onPosted={vi.fn()} />);
    const textarea = screen.getByTestId('comment-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'ok' } });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('preserves the textarea on error and shows inline message', async () => {
    mockPostComment.mockRejectedValueOnce(new Error('boom'));
    render(<PaymentCommentInput paymentId="p-1" onPosted={vi.fn()} />);
    const textarea = screen.getByTestId('comment-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'keepme' } });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('comment-input-error')).toHaveTextContent('errorPost'),
    );
    expect(textarea.value).toBe('keepme');
  });

  it('submit button is disabled when the disabled prop is true', () => {
    render(<PaymentCommentInput paymentId="p-1" onPosted={vi.fn()} disabled />);
    expect(screen.getByTestId('comment-input-submit')).toBeDisabled();
    expect(screen.getByTestId('comment-input-textarea')).toBeDisabled();
  });
});
