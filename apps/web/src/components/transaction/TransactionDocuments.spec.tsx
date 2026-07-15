import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDocuments } from './PaymentDocuments';

const mockGetReceipt = vi.fn();
const mockFetchFileBlob = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ getReceipt: mockGetReceipt, fetchFileBlob: mockFetchFileBlob }),
}));

// Stub the shared viewer — its own behaviour is covered by its spec; here we
// only assert PaymentDocuments opens it with the fetched blob URL / error.
vi.mock('@/components/receipt/ReceiptDocumentViewer', () => ({
  ReceiptDocumentViewer: ({
    open,
    url,
    loadError,
    title,
  }: {
    open: boolean;
    url: string | null;
    loadError?: boolean;
    title: string;
  }) =>
    open ? (
      <div
        data-testid="mock-viewer"
        data-url={url ?? ''}
        data-load-error={loadError ? 'true' : 'false'}
        data-title={title}
      />
    ) : null,
}));

describe('PaymentDocuments (8.19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('lists an uploaded file and opens it in the viewer with the fetched blob', async () => {
    mockGetReceipt.mockResolvedValue({
      id: 'r-1',
      source: 'upload',
      mimeType: 'image/jpeg',
      originalName: 'receipt.jpg',
    });
    mockFetchFileBlob.mockResolvedValue(new Blob(['x']));
    render(<PaymentDocuments receiptId="r-1" />);

    await waitFor(() => expect(screen.getByTestId('payment-document-file')).toBeInTheDocument());
    expect(screen.getByText('receipt.jpg')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('payment-document-view'));
    await waitFor(() => expect(screen.getByTestId('mock-viewer')).toBeInTheDocument());
    expect(mockFetchFileBlob).toHaveBeenCalledWith('r-1');
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-url', 'blob:mock');
    // Viewer titled by the FILE NAME (language-neutral), not the merchant.
    expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-title', 'receipt.jpg');
  });

  it('surfaces a file-load failure in the viewer instead of spinning forever', async () => {
    mockGetReceipt.mockResolvedValue({
      id: 'r-1',
      source: 'upload',
      mimeType: 'image/jpeg',
      originalName: 'receipt.jpg',
    });
    mockFetchFileBlob.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    render(<PaymentDocuments receiptId="r-1" />);

    await waitFor(() => expect(screen.getByTestId('payment-document-file')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('payment-document-view'));
    await waitFor(() =>
      expect(screen.getByTestId('mock-viewer')).toHaveAttribute('data-load-error', 'true'),
    );
  });

  it('links out for a URL-sourced receipt (no in-app viewer)', async () => {
    mockGetReceipt.mockResolvedValue({
      id: 'r-2',
      source: 'url',
      sourceUrl: 'https://r.example/x',
      mimeType: null,
    });
    render(<PaymentDocuments receiptId="r-2" />);

    await waitFor(() =>
      expect(screen.getByTestId('payment-document-external')).toHaveAttribute(
        'href',
        'https://r.example/x',
      ),
    );
    expect(screen.queryByTestId('payment-document-view')).not.toBeInTheDocument();
  });

  it('shows a "no document" note for a receipt with no file (e.g. manual)', async () => {
    mockGetReceipt.mockResolvedValue({ id: 'r-3', source: 'manual', mimeType: null });
    render(<PaymentDocuments receiptId="r-3" />);
    await waitFor(() => expect(screen.getByTestId('payment-documents-none')).toBeInTheDocument());
  });

  it('shows a soft "unavailable" note when the receipt is not readable (404)', async () => {
    mockGetReceipt.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    render(<PaymentDocuments receiptId="r-4" />);
    await waitFor(() =>
      expect(screen.getByTestId('payment-documents-unavailable')).toBeInTheDocument(),
    );
  });
});
