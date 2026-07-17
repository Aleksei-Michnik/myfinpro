import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptDocumentViewer } from './ReceiptDocumentViewer';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

const noop = () => {};
const page = (url: string | null, mimeType = 'image/png') => ({ url, mimeType });

describe('ReceiptDocumentViewer (8.18)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    render(
      <ReceiptDocumentViewer open={false} pages={[page('blob:x')]} title="R" onClose={noop} />,
    );
    expect(screen.queryByTestId('receipt-viewer')).not.toBeInTheDocument();
  });

  it('shows a loader while the blob URL is still resolving', () => {
    render(<ReceiptDocumentViewer open pages={[page(null)]} title="R" onClose={noop} />);
    expect(screen.getByTestId('viewer-loading')).toBeInTheDocument();
  });

  it('shows a load-failure message (not the endless spinner) on loadError', () => {
    render(<ReceiptDocumentViewer open pages={[page(null)]} loadError title="R" onClose={noop} />);
    expect(screen.getByTestId('viewer-load-error')).toHaveTextContent('loadFailed');
    expect(screen.queryByTestId('viewer-loading')).not.toBeInTheDocument();
  });

  it('renders an image with zoom controls and zooms in', () => {
    render(
      <ReceiptDocumentViewer open pages={[page('blob:img')]} title="Receipt" onClose={noop} />,
    );
    expect(screen.getByTestId('viewer-image')).toHaveAttribute('src', 'blob:img');
    expect(screen.getByTestId('viewer-zoom-level')).toHaveTextContent('100%');
    // Reset is a no-op at 1× → disabled until we zoom.
    expect(screen.getByTestId('viewer-zoom-reset')).toBeDisabled();

    fireEvent.click(screen.getByTestId('viewer-zoom-in'));
    expect(screen.getByTestId('viewer-zoom-level')).toHaveTextContent('150%');
    expect(screen.getByTestId('viewer-zoom-reset')).toBeEnabled();
  });

  it('renders the native PDF viewer (no zoom controls) for PDFs', () => {
    render(
      <ReceiptDocumentViewer
        open
        pages={[page('blob:pdf', 'application/pdf')]}
        title="R"
        onClose={noop}
      />,
    );
    expect(screen.getByTestId('viewer-pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('viewer-image')).not.toBeInTheDocument();
    expect(screen.queryByTestId('viewer-zoom-in')).not.toBeInTheDocument();
  });

  it('multi-photo receipts get a pager; zoom resets on page change (8.22)', () => {
    render(
      <ReceiptDocumentViewer
        open
        pages={[page('blob:p1'), page('blob:p2')]}
        title="R"
        onClose={noop}
      />,
    );
    expect(screen.getByTestId('viewer-page-indicator')).toHaveTextContent('pageOf:1,2');
    expect(screen.getByTestId('viewer-image')).toHaveAttribute('src', 'blob:p1');
    expect(screen.getByTestId('viewer-prev-page')).toBeDisabled();

    // Zoom in, then flip a page — the transform resets for the new page.
    fireEvent.click(screen.getByTestId('viewer-zoom-in'));
    expect(screen.getByTestId('viewer-zoom-level')).toHaveTextContent('150%');
    fireEvent.click(screen.getByTestId('viewer-next-page'));
    expect(screen.getByTestId('viewer-image')).toHaveAttribute('src', 'blob:p2');
    expect(screen.getByTestId('viewer-page-indicator')).toHaveTextContent('pageOf:2,2');
    expect(screen.getByTestId('viewer-zoom-level')).toHaveTextContent('100%');
    expect(screen.getByTestId('viewer-next-page')).toBeDisabled();
  });

  it('single-page documents render no pager', () => {
    render(<ReceiptDocumentViewer open pages={[page('blob:img')]} title="R" onClose={noop} />);
    expect(screen.queryByTestId('viewer-page-indicator')).not.toBeInTheDocument();
  });

  it('closes on ESC, backdrop click and the close button', () => {
    const onClose = vi.fn();
    render(<ReceiptDocumentViewer open pages={[page('blob:img')]} title="R" onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('receipt-viewer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('viewer-close'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
