import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachReceiptDialog } from './AttachReceiptDialog';
import type { ReceiptSummary } from '@/lib/receipt/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const attachFileMock = vi.fn();
const attachUrlMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({
    attachFileToTransaction: attachFileMock,
    attachUrlToTransaction: attachUrlMock,
  }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

function renderDialog() {
  const onClose = vi.fn();
  const onAttached = vi.fn();
  render(
    <AttachReceiptDialog open transactionId="pay-1" onClose={onClose} onAttached={onAttached} />,
  );
  return { onClose, onAttached };
}

describe('AttachReceiptDialog (8.15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads a device file to the transaction and hands back the receipt', async () => {
    const created = { id: 'r-1' } as ReceiptSummary;
    attachFileMock.mockResolvedValue(created);
    const { onAttached } = renderDialog();

    const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('attach-receipt-file'), { target: { files: [file] } });

    await waitFor(() =>
      expect(attachFileMock).toHaveBeenCalledWith('pay-1', file, expect.anything()),
    );
    await waitFor(() => expect(onAttached).toHaveBeenCalledWith(created));
  });

  it('attaches a trimmed URL to the transaction', async () => {
    const created = { id: 'r-2' } as ReceiptSummary;
    attachUrlMock.mockResolvedValue(created);
    const { onAttached } = renderDialog();

    fireEvent.change(screen.getByTestId('attach-receipt-url-input'), {
      target: { value: '  https://shop.example/r/9  ' },
    });
    fireEvent.click(screen.getByTestId('attach-receipt-url-submit'));

    await waitFor(() =>
      expect(attachUrlMock).toHaveBeenCalledWith(
        'pay-1',
        'https://shop.example/r/9',
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onAttached).toHaveBeenCalledWith(created));
  });

  it('toasts and stays open when the attach fails', async () => {
    attachUrlMock.mockRejectedValue(new Error('This transaction already has a receipt'));
    const { onAttached } = renderDialog();

    fireEvent.change(screen.getByTestId('attach-receipt-url-input'), {
      target: { value: 'https://shop.example/r/9' },
    });
    fireEvent.click(screen.getByTestId('attach-receipt-url-submit'));

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('already has')),
    );
    expect(onAttached).not.toHaveBeenCalled();
  });
});
