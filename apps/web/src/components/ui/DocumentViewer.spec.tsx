import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentViewer } from './DocumentViewer';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

const noop = () => {};
const page = (src: string | null, kind: 'image' | 'pdf' = 'image') => ({ kind, src });

describe('DocumentViewer (8.18, generalized 8.27)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    render(<DocumentViewer open={false} pages={[page('blob:x')]} title="R" onClose={noop} />);
    expect(screen.queryByTestId('document-viewer')).not.toBeInTheDocument();
  });

  it('shows a loader while the blob URL is still resolving', () => {
    render(<DocumentViewer open pages={[page(null)]} title="R" onClose={noop} />);
    expect(screen.getByTestId('viewer-loading')).toBeInTheDocument();
  });

  it('shows a load-failure message (not the endless spinner) on loadError', () => {
    render(<DocumentViewer open pages={[page(null)]} loadError title="R" onClose={noop} />);
    expect(screen.getByTestId('viewer-load-error')).toHaveTextContent('loadFailed');
    expect(screen.queryByTestId('viewer-loading')).not.toBeInTheDocument();
  });

  it('renders an image with zoom controls and zooms in', () => {
    render(<DocumentViewer open pages={[page('blob:img')]} title="Receipt" onClose={noop} />);
    expect(screen.getByTestId('viewer-image')).toHaveAttribute('src', 'blob:img');
    expect(screen.getByTestId('viewer-zoom-level')).toHaveTextContent('100%');
    // Reset is a no-op at 1× → disabled until we zoom.
    expect(screen.getByTestId('viewer-zoom-reset')).toBeDisabled();

    fireEvent.click(screen.getByTestId('viewer-zoom-in'));
    expect(screen.getByTestId('viewer-zoom-level')).toHaveTextContent('150%');
    expect(screen.getByTestId('viewer-zoom-reset')).toBeEnabled();
  });

  it('renders the native PDF viewer (no zoom controls) for PDFs', () => {
    render(<DocumentViewer open pages={[page('blob:pdf', 'pdf')]} title="R" onClose={noop} />);
    expect(screen.getByTestId('viewer-pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('viewer-image')).not.toBeInTheDocument();
    expect(screen.queryByTestId('viewer-zoom-in')).not.toBeInTheDocument();
  });

  it('the PDF download fallback carries the suggested file name', () => {
    render(
      <DocumentViewer
        open
        pages={[{ kind: 'pdf', src: 'blob:pdf', downloadName: 'receipt.pdf' }]}
        title="R"
        onClose={noop}
      />,
    );
    expect(screen.getByTestId('viewer-pdf-fallback')).toHaveAttribute('download', 'receipt.pdf');
  });

  it('multi-page documents get a pager; zoom resets on page change (8.22)', () => {
    render(
      <DocumentViewer open pages={[page('blob:p1'), page('blob:p2')]} title="R" onClose={noop} />,
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

  it('opens on initialIndex (product gallery hands over the selected picture)', () => {
    render(
      <DocumentViewer
        open
        pages={[page('blob:p1'), page('blob:p2'), page('blob:p3')]}
        initialIndex={2}
        title="R"
        onClose={noop}
      />,
    );
    expect(screen.getByTestId('viewer-image')).toHaveAttribute('src', 'blob:p3');
    expect(screen.getByTestId('viewer-page-indicator')).toHaveTextContent('pageOf:3,3');
  });

  it('single-page documents render no pager', () => {
    render(<DocumentViewer open pages={[page('blob:img')]} title="R" onClose={noop} />);
    expect(screen.queryByTestId('viewer-page-indicator')).not.toBeInTheDocument();
  });

  it('closes on ESC, backdrop click and the close button', () => {
    const onClose = vi.fn();
    render(<DocumentViewer open pages={[page('blob:img')]} title="R" onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('document-viewer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('viewer-close'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
