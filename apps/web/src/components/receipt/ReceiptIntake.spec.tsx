import { RECEIPT_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptIntake, type ReceiptIntakeProps } from './ReceiptIntake';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values && 'count' in values ? `${key}:${values.count}` : key,
}));

const uploadReceiptMock = vi.fn();
const createFromUrlMock = vi.fn();
const attachFileMock = vi.fn();
const attachUrlMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({
    uploadReceipt: uploadReceiptMock,
    createFromUrl: createFromUrlMock,
    attachFileToTransaction: attachFileMock,
    attachUrlToTransaction: attachUrlMock,
  }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const image = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
const pdf = (name = 'slip.pdf') => new File(['x'], name, { type: 'application/pdf' });

function renderIntake(props: Partial<ReceiptIntakeProps> = {}) {
  const onCreated = vi.fn();
  const view = render(
    <ReceiptIntake
      target={{ kind: 'standalone' }}
      onCreated={onCreated}
      testIdPrefix="ri"
      {...props}
    />,
  );
  return { onCreated, ...view };
}

const pick = (files: File[]) =>
  fireEvent.change(screen.getByTestId('ri-file-input'), { target: { files } });
const shoot = (files: File[]) =>
  fireEvent.change(screen.getByTestId('ri-camera-input'), { target: { files } });

describe('ReceiptIntake (8.29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('uploads a single picked image straight away and hands the receipt back', async () => {
    uploadReceiptMock.mockResolvedValue({ id: 'r-1' });
    const { onCreated } = renderIntake();

    const file = image('a.jpg');
    pick([file]);

    await waitFor(() => expect(uploadReceiptMock).toHaveBeenCalledWith([file], expect.anything()));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith([{ id: 'r-1' }]));
    expect(screen.queryByTestId('ri-staged')).toBeNull();
  });

  it('stages camera shots as the pages of one receipt and uploads them together', async () => {
    uploadReceiptMock.mockResolvedValue({ id: 'r-long' });
    const { onCreated } = renderIntake();

    const p1 = image('p1.jpg');
    const p2 = image('p2.jpg');
    shoot([p1]);
    expect(screen.getByTestId('ri-staged')).toBeInTheDocument();
    shoot([p2]);
    expect(screen.getByTestId('ri-staged-page-2')).toBeInTheDocument();
    expect(uploadReceiptMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('ri-staged-upload-one'));

    await waitFor(() =>
      expect(uploadReceiptMock).toHaveBeenCalledWith([p1, p2], expect.anything()),
    );
    expect(uploadReceiptMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith([{ id: 'r-long' }]));
    await waitFor(() => expect(screen.queryByTestId('ri-staged')).toBeNull());
  });

  it('stages a multi-image pick instead of guessing, and can split it into receipts', async () => {
    uploadReceiptMock.mockResolvedValueOnce({ id: 'r-a' }).mockResolvedValueOnce({ id: 'r-b' });
    const { onCreated } = renderIntake();

    const p1 = image('p1.jpg');
    const p2 = image('p2.jpg');
    pick([p1, p2]);
    expect(uploadReceiptMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('ri-staged')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ri-staged-upload-separately'));

    await waitFor(() => expect(uploadReceiptMock).toHaveBeenCalledTimes(2));
    expect(uploadReceiptMock).toHaveBeenNthCalledWith(1, [p1], expect.anything());
    expect(uploadReceiptMock).toHaveBeenNthCalledWith(2, [p2], expect.anything());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith([{ id: 'r-a' }, { id: 'r-b' }]));
  });

  it('standalone: a PDF becomes its own receipt while the images stage', async () => {
    uploadReceiptMock.mockResolvedValue({ id: 'r-pdf' });
    renderIntake();

    const slip = pdf();
    pick([slip, image('p1.jpg')]);

    await waitFor(() => expect(uploadReceiptMock).toHaveBeenCalledWith([slip], expect.anything()));
    expect(uploadReceiptMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ri-staged-page-1')).toBeInTheDocument();
  });

  it('transaction: a lone PDF attaches to the transaction', async () => {
    attachFileMock.mockResolvedValue({ id: 'r-attached' });
    const { onCreated } = renderIntake({ target: { kind: 'transaction', transactionId: 'p-1' } });

    const slip = pdf();
    pick([slip]);

    await waitFor(() =>
      expect(attachFileMock).toHaveBeenCalledWith('p-1', [slip], expect.anything()),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith([{ id: 'r-attached' }]));
  });

  it('transaction: a PDF picked with an image is refused; the image stages, without a split action', () => {
    renderIntake({ target: { kind: 'transaction', transactionId: 'p-1' } });

    pick([pdf(), image('p1.jpg'), image('p2.jpg')]);

    expect(addToastMock).toHaveBeenCalledWith('error', 'pdfAlone');
    expect(attachFileMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('ri-staged-page-2')).toBeInTheDocument();
    expect(screen.queryByTestId('ri-staged-upload-separately')).toBeNull();
  });

  it('routes dropped files exactly like a picker pick', async () => {
    uploadReceiptMock.mockResolvedValue({ id: 'r-dropped' });
    renderIntake();

    const file = image('dropped.jpg');
    fireEvent.drop(screen.getByTestId('ri-intake'), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(uploadReceiptMock).toHaveBeenCalledWith([file], expect.anything()));
  });

  it('rejects unsupported files client-side before any request (8.27)', async () => {
    renderIntake();

    pick([new File(['x'], 'x.gif', { type: 'image/gif' })]);

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('rejectedType')),
    );
    expect(uploadReceiptMock).not.toHaveBeenCalled();
  });

  it('rejects oversized files client-side before any request (8.27)', async () => {
    renderIntake();

    const big = image('huge.jpg');
    Object.defineProperty(big, 'size', { value: RECEIPT_MAX_FILE_SIZE_BYTES + 1 });
    pick([big]);

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('rejectedSize')),
    );
    expect(uploadReceiptMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ri-staged')).toBeNull();
  });

  it('opens the URL row on demand; Enter adds the receipt without submitting the host form', async () => {
    createFromUrlMock.mockResolvedValue({ id: 'r-url' });
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onCreated = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <ReceiptIntake target={{ kind: 'standalone' }} onCreated={onCreated} testIdPrefix="ri" />
      </form>,
    );

    expect(screen.queryByTestId('ri-url-input')).toBeNull();
    const toggle = screen.getByTestId('ri-url-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const input = screen.getByTestId('ri-url-input');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '  https://shop.example/r/9  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(createFromUrlMock).toHaveBeenCalledWith('https://shop.example/r/9', expect.anything()),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith([{ id: 'r-url' }]));
    expect(onSubmit).not.toHaveBeenCalled();
    // Success closes the row.
    await waitFor(() => expect(screen.queryByTestId('ri-url-input')).toBeNull());
  });

  it('attaches a URL to the transaction target', async () => {
    attachUrlMock.mockResolvedValue({ id: 'r-url-tx' });
    renderIntake({ target: { kind: 'transaction', transactionId: 'p-1' } });

    fireEvent.click(screen.getByTestId('ri-url-toggle'));
    fireEvent.change(screen.getByTestId('ri-url-input'), {
      target: { value: 'https://shop.example/r/9' },
    });
    fireEvent.click(screen.getByTestId('ri-url-submit'));

    await waitFor(() =>
      expect(attachUrlMock).toHaveBeenCalledWith(
        'p-1',
        'https://shop.example/r/9',
        expect.anything(),
      ),
    );
  });

  it('toasts a failure and keeps the staged pages so the user can retry', async () => {
    uploadReceiptMock.mockRejectedValue(new Error('Storage unavailable'));
    const { onCreated } = renderIntake();

    shoot([image('p1.jpg')]);
    fireEvent.click(screen.getByTestId('ri-staged-upload-one'));

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('Storage')),
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId('ri-staged')).toBeInTheDocument();
  });

  it('renders the host extras only when their handlers are given', () => {
    const { rerender } = renderIntake();
    expect(screen.queryByTestId('ri-barcodes')).toBeNull();
    expect(screen.queryByTestId('ri-link-existing')).toBeNull();

    const onScanBarcodes = vi.fn();
    const onLinkExisting = vi.fn();
    rerender(
      <ReceiptIntake
        target={{ kind: 'standalone' }}
        onCreated={vi.fn()}
        onScanBarcodes={onScanBarcodes}
        onLinkExisting={onLinkExisting}
        testIdPrefix="ri"
      />,
    );
    fireEvent.click(screen.getByTestId('ri-barcodes'));
    fireEvent.click(screen.getByTestId('ri-link-existing'));
    expect(onScanBarcodes).toHaveBeenCalled();
    expect(onLinkExisting).toHaveBeenCalled();
  });

  it('disables every action while a create is in flight', async () => {
    uploadReceiptMock.mockReturnValue(new Promise(() => {}));
    renderIntake({ onScanBarcodes: vi.fn() });

    pick([image('a.jpg')]);

    await waitFor(() => expect(screen.getByTestId('button-spinner')).toBeInTheDocument());
    const block = screen.getByTestId('ri-intake');
    expect(block.getAttribute('aria-busy')).toBe('true');
    for (const id of ['ri-browse-button', 'ri-camera-button', 'ri-url-toggle', 'ri-barcodes']) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    }
    // Drops are ignored while pending.
    fireEvent.drop(block, { dataTransfer: { files: [image('b.jpg')] } });
    expect(uploadReceiptMock).toHaveBeenCalledTimes(1);
  });

  it('honours the host busy state without a spinner of its own', () => {
    renderIntake({ disabled: true });
    expect((screen.getByTestId('ri-browse-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('button-spinner')).toBeNull();
  });

  it('caps a staged receipt at the shared page limit', () => {
    renderIntake();

    shoot(Array.from({ length: 9 }, (_, i) => image(`p${i + 1}.jpg`)));

    expect(addToastMock).toHaveBeenCalledWith('error', 'tooManyPages');
    expect(screen.getByTestId('ri-staged-page-8')).toBeInTheDocument();
    expect(screen.queryByTestId('ri-staged-page-9')).toBeNull();
  });

  it('removes a staged page and clears the tray', () => {
    renderIntake();

    shoot([image('p1.jpg'), image('p2.jpg')]);
    fireEvent.click(screen.getByTestId('ri-staged-remove-1'));
    expect(screen.queryByTestId('ri-staged-page-2')).toBeNull();

    fireEvent.click(screen.getByTestId('ri-staged-clear'));
    expect(screen.queryByTestId('ri-staged')).toBeNull();
  });
});
