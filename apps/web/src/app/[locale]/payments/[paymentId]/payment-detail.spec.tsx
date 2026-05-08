import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDetailClient } from './payment-detail-client';
import type { PaymentSummary } from '@/lib/payment/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetPayment = vi.fn();
const mockListComments = vi.fn();
const mockPostComment = vi.fn();
const mockEditComment = vi.fn();
const mockDeleteComment = vi.fn();
const mockToggleStar = vi.fn();
const mockRemovePayment = vi.fn();
const mockUpdatePayment = vi.fn();
const mockCreatePayment = vi.fn();
const mockListCategories = vi.fn();

const mockRouterReplace = vi.fn();
const mockRouterPush = vi.fn();
const mockAddToast = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values && 'message' in values ? `${key}:${values.message}` : key,
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: mockRouterPush }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', defaultCurrency: 'USD' } }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({ groups: [] }),
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    getPayment: mockGetPayment,
    listComments: mockListComments,
    postComment: mockPostComment,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
    toggleStar: mockToggleStar,
    removePayment: mockRemovePayment,
    updatePayment: mockUpdatePayment,
    createPayment: mockCreatePayment,
    listCategories: mockListCategories,
  }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePayment(p: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    id: 'p-1',
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1234,
    currency: 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: { id: 'c-1', slug: 'misc', name: 'Misc', icon: null, color: null },
    attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
    note: null,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentPaymentId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    ...p,
  };
}

describe('PaymentDetailClient', () => {
  beforeEach(() => {
    mockGetPayment.mockReset();
    mockListComments.mockReset();
    mockListComments.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    mockPostComment.mockReset();
    mockEditComment.mockReset();
    mockDeleteComment.mockReset();
    mockToggleStar.mockReset();
    mockRemovePayment.mockReset();
    mockUpdatePayment.mockReset();
    mockCreatePayment.mockReset();
    mockListCategories.mockReset();
    mockListCategories.mockResolvedValue([]);
    mockRouterReplace.mockReset();
    mockRouterPush.mockReset();
    mockAddToast.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading spinner while fetching', () => {
    mockGetPayment.mockReturnValueOnce(new Promise(() => {}));
    render(<PaymentDetailClient paymentId="p-1" />);
    expect(screen.getByTestId('payment-detail-loading')).toBeInTheDocument();
  });

  it('renders the 404 error card when the API returns 404', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 });
    mockGetPayment.mockRejectedValueOnce(err);
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-error')).toBeInTheDocument());
    expect(screen.getByTestId('payment-detail-error-title').textContent).toMatch(/notFound/);
    expect(screen.queryByTestId('payment-detail-retry')).not.toBeInTheDocument();
  });

  it('generic error card offers Try again', async () => {
    const err = Object.assign(new Error('network'), { status: 500 });
    mockGetPayment.mockRejectedValueOnce(err);
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-error')).toBeInTheDocument());
    mockGetPayment.mockResolvedValueOnce(makePayment());
    fireEvent.click(screen.getByTestId('payment-detail-retry'));
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
  });

  it('successful render shows header + documents placeholder + comments; no schedule for ONE_TIME', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    expect(screen.getByTestId('payment-documents-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('payment-comment-list')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-schedule-plan-placeholder')).not.toBeInTheDocument();
  });

  it('edit button opens the <PaymentFormDialog>', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detail-edit'));
    expect(screen.getByTestId('payment-form-dialog')).toBeInTheDocument();
  });

  it('delete button opens the <DeletePaymentDialog>', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detail-delete'));
    expect(screen.getByTestId('delete-payment-dialog')).toBeInTheDocument();
  });

  it('delete with paymentDeleted=true redirects to /dashboard with toast', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detail-delete'));
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: true,
      payment: null,
    });
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockAddToast).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('delete with paymentDeleted=false re-fetches and keeps the page visible', async () => {
    const first = makePayment({ note: 'one' });
    const second = makePayment({ note: 'two' });
    mockGetPayment.mockResolvedValueOnce(first);
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-note')).toHaveTextContent('one'));
    fireEvent.click(screen.getByTestId('detail-delete'));
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: false,
      payment: null,
    });
    mockGetPayment.mockResolvedValueOnce(second);
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(screen.getByTestId('detail-note')).toHaveTextContent('two'));
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('star toggle in header updates state', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    mockToggleStar.mockResolvedValueOnce({ starred: true, starCount: 1 });
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-star')).toBeInTheDocument());
    const btn = screen.getByTestId('detail-star');
    fireEvent.click(btn);
    await waitFor(() => expect(mockToggleStar).toHaveBeenCalledWith('p-1'));
  });

  it('new comment posted via input appears at the bottom of the list', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-comment-list')).toBeInTheDocument());
    mockPostComment.mockResolvedValueOnce({
      id: 'c-new',
      paymentId: 'p-1',
      author: { id: 'me', name: 'Me' },
      content: 'hi',
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
      deletedAt: null,
      isMine: true,
    });
    fireEvent.change(screen.getByTestId('comment-input-textarea'), {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(screen.getByTestId('comment-row-c-new')).toBeInTheDocument());
  });

  it('schedule/plan placeholder is shown when payment has a parentPaymentId', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ parentPaymentId: 'parent-1' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('payment-schedule-plan-placeholder')).toBeInTheDocument(),
    );
  });

  it('schedule/plan placeholder is shown for non-ONE_TIME types', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('payment-schedule-plan-placeholder')).toBeInTheDocument(),
    );
  });

  it('back link points to /dashboard', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-back')).toBeInTheDocument());
    expect(screen.getByTestId('payment-detail-back').getAttribute('href')).toBe('/dashboard');
  });
});
