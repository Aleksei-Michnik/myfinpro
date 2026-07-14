import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptDocumentViewer } from './ReceiptDocumentViewer';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const noop = () => {};

describe('ReceiptDocumentViewer (8.18)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    render(
      <ReceiptDocumentViewer
        open={false}
        url="blob:x"
        mimeType="image/png"
        title="R"
        onClose={noop}
      />,
    );
    expect(screen.queryByTestId('receipt-viewer')).not.toBeInTheDocument();
  });

  it('shows a loader while the blob URL is still resolving', () => {
    render(<ReceiptDocumentViewer open url={null} mimeType="image/png" title="R" onClose={noop} />);
    expect(screen.getByTestId('viewer-loading')).toBeInTheDocument();
  });

  it('shows a load-failure message (not the endless spinner) on loadError', () => {
    render(
      <ReceiptDocumentViewer
        open
        url={null}
        loadError
        mimeType="image/png"
        title="R"
        onClose={noop}
      />,
    );
    expect(screen.getByTestId('viewer-load-error')).toHaveTextContent('loadFailed');
    expect(screen.queryByTestId('viewer-loading')).not.toBeInTheDocument();
  });

  it('renders an image with zoom controls and zooms in', () => {
    render(
      <ReceiptDocumentViewer
        open
        url="blob:img"
        mimeType="image/png"
        title="Receipt"
        onClose={noop}
      />,
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
        url="blob:pdf"
        mimeType="application/pdf"
        title="R"
        onClose={noop}
      />,
    );
    expect(screen.getByTestId('viewer-pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('viewer-image')).not.toBeInTheDocument();
    expect(screen.queryByTestId('viewer-zoom-in')).not.toBeInTheDocument();
  });

  it('closes on ESC, backdrop click and the close button', () => {
    const onClose = vi.fn();
    render(
      <ReceiptDocumentViewer
        open
        url="blob:img"
        mimeType="image/png"
        title="R"
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('receipt-viewer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('viewer-close'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
