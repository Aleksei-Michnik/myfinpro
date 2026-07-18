import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductGallery } from './ProductGallery';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

const uploadImageMock = vi.fn();
const removeImageMock = vi.fn();
const reorderImageMock = vi.fn();
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({
    uploadImage: uploadImageMock,
    removeImage: removeImageMock,
    reorderImage: reorderImageMock,
    productImageUrl: (id: string, img: { id: string; version: string }, size?: string) =>
      `/api/v1/products/${id}/images/${img.id}?size=${size ?? 'full'}&v=${img.version}`,
  }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// The viewer has its own spec — the stub surfaces what it was opened with.
vi.mock('@/components/ui/DocumentViewer', () => ({
  DocumentViewer: ({
    open,
    pages,
    initialIndex,
    title,
  }: {
    open: boolean;
    pages: { kind: string; src: string | null }[];
    initialIndex?: number;
    title: string;
  }) =>
    open ? (
      <div
        data-testid="viewer-stub"
        data-pages={pages.map((p) => p.src).join('|')}
        data-kinds={pages.map((p) => p.kind).join('|')}
        data-initial={initialIndex}
        data-title={title}
      />
    ) : null,
}));

const images = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `img-${i + 1}`,
    position: i + 1,
    version: `v${i + 1}`,
  }));

const product = (imageCount = 3) => ({ id: 'p-1', name: 'Milk 3% 1L', images: images(imageCount) });

const pickFiles = (files: File[]) =>
  fireEvent.change(screen.getByTestId('product-gallery-file-input'), { target: { files } });

const imageFile = (name: string, size = 4) => {
  const file = new File(['x'], name, { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

/** src of the currently shown main picture. */
const mainSrc = () =>
  screen.getByTestId('product-gallery-main').querySelector('img')?.getAttribute('src');

/** A horizontal drag on the main picture (pointer capture path). */
const swipeMain = (fromX: number, toX: number, y = 10, toY = y) => {
  const main = screen.getByTestId('product-gallery-main');
  fireEvent.pointerDown(main, { clientX: fromX, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(main, { clientX: toX, clientY: toY, pointerId: 1 });
};

describe('ProductGallery (8.27)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => document.documentElement.removeAttribute('dir'));

  it('shows the primary picture large and all pictures as thumbs', () => {
    render(<ProductGallery product={product()} editable={false} />);

    expect(mainSrc()).toBe('/api/v1/products/p-1/images/img-1?size=full&v=v1');
    expect(
      screen.getByTestId('product-gallery-thumb-0').querySelector('img')?.getAttribute('src'),
    ).toBe('/api/v1/products/p-1/images/img-1?size=thumb&v=v1');
  });

  it('the ring outlines the SELECTED thumb and follows the selection', () => {
    render(<ProductGallery product={product()} editable={false} />);

    const thumbImg = (i: number) =>
      screen.getByTestId(`product-gallery-thumb-${i}`).querySelector('img')?.className ?? '';
    expect(thumbImg(0)).toContain('ring-2');
    expect(thumbImg(1)).not.toContain('ring-2');

    fireEvent.click(screen.getByTestId('product-gallery-thumb-1'));
    expect(thumbImg(0)).not.toContain('ring-2');
    expect(thumbImg(1)).toContain('ring-2');
    expect(screen.getByTestId('product-gallery-thumb-1')).toHaveAttribute('aria-current', 'true');
  });

  it('the primary thumb carries a static star badge in both modes', () => {
    const { unmount } = render(<ProductGallery product={product()} editable={false} />);
    expect(screen.getByTestId('product-gallery-primary-badge-0')).toBeInTheDocument();
    expect(screen.queryByTestId('product-gallery-primary-badge-1')).toBeNull();
    unmount();

    render(<ProductGallery product={product()} editable />);
    const badge = screen.getByTestId('product-gallery-primary-badge-0');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveAttribute('title', 'primaryPicture');
    // The primary itself never offers make-primary; the others do.
    expect(screen.queryByTestId('product-gallery-primary-0')).toBeNull();
    expect(screen.getByTestId('product-gallery-primary-1')).toBeInTheDocument();
  });

  it('renders the cube placeholder for a product without pictures', () => {
    render(<ProductGallery product={product(0)} editable={false} />);
    expect(screen.queryByTestId('product-gallery-main')).toBeNull();
    expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
  });

  it('clicking a thumb selects it as the main picture', () => {
    render(<ProductGallery product={product()} editable={false} />);
    fireEvent.click(screen.getByTestId('product-gallery-thumb-1'));
    expect(screen.getByTestId('product-gallery-main').querySelector('img')).toHaveAttribute(
      'src',
      '/api/v1/products/p-1/images/img-2?size=full&v=v2',
    );
  });

  it('clicking the main picture opens the lightbox over ALL pictures at the selection', () => {
    render(<ProductGallery product={product()} editable={false} />);
    fireEvent.click(screen.getByTestId('product-gallery-thumb-2'));
    fireEvent.click(screen.getByTestId('product-gallery-main'));

    const viewer = screen.getByTestId('viewer-stub');
    expect(viewer).toHaveAttribute(
      'data-pages',
      [
        '/api/v1/products/p-1/images/img-1?size=full&v=v1',
        '/api/v1/products/p-1/images/img-2?size=full&v=v2',
        '/api/v1/products/p-1/images/img-3?size=full&v=v3',
      ].join('|'),
    );
    expect(viewer).toHaveAttribute('data-kinds', 'image|image|image');
    expect(viewer).toHaveAttribute('data-initial', '2');
    expect(viewer).toHaveAttribute('data-title', 'Milk 3% 1L');
  });

  it('read-only mode renders no management controls', () => {
    render(<ProductGallery product={product()} editable={false} />);
    expect(screen.queryByTestId('product-gallery-remove-0')).toBeNull();
    expect(screen.queryByTestId('product-gallery-primary-1')).toBeNull();
    expect(screen.queryByTestId('product-gallery-browse-button')).toBeNull();
  });

  it('editable: remove asks for confirmation, then calls the context and reports', async () => {
    removeImageMock.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<ProductGallery product={product()} editable onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId('product-gallery-remove-1'));
    // Nothing removed yet — the ConfirmDialog collects the decision first.
    expect(removeImageMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() =>
      expect(removeImageMock).toHaveBeenCalledWith('p-1', 'img-2', expect.anything()),
    );
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('editable: cancelling the confirmation removes nothing', () => {
    const onChanged = vi.fn();
    render(<ProductGallery product={product()} editable onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId('product-gallery-remove-1'));
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(removeImageMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('editable: make-primary reorders to position 1 (no button on the primary itself)', async () => {
    reorderImageMock.mockResolvedValue(images(3));
    const onChanged = vi.fn();
    render(<ProductGallery product={product()} editable onChanged={onChanged} />);

    expect(screen.queryByTestId('product-gallery-primary-0')).toBeNull();
    fireEvent.click(screen.getByTestId('product-gallery-primary-2'));
    await waitFor(() =>
      expect(reorderImageMock).toHaveBeenCalledWith('p-1', 'img-3', 1, expect.anything()),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('editable: validates, uploads immediately, toasts and reports the change', async () => {
    uploadImageMock.mockResolvedValue({ id: 'img-4', position: 4, version: 'v4' });
    const onChanged = vi.fn();
    render(<ProductGallery product={product()} editable onChanged={onChanged} />);

    const good = imageFile('good.jpg');
    const oversize = imageFile('huge.jpg', 20 * 1024 * 1024);
    pickFiles([good, oversize]);

    await waitFor(() =>
      expect(uploadImageMock).toHaveBeenCalledWith('p-1', good, expect.anything()),
    );
    expect(uploadImageMock).toHaveBeenCalledTimes(1);
    expect(addToastMock).toHaveBeenCalledWith('error', 'rejectedSize:huge.jpg,10');
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'imageQueuedToast'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('caps additions at the remaining slots and hides the capture controls when full', async () => {
    uploadImageMock.mockResolvedValue({ id: 'img-5', position: 5, version: 'v5' });
    const { unmount } = render(<ProductGallery product={product(4)} editable />);

    pickFiles([imageFile('a.jpg'), imageFile('b.jpg'), imageFile('c.jpg')]);
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(1));
    unmount();

    render(<ProductGallery product={product(5)} editable />);
    expect(screen.queryByTestId('product-gallery-browse-button')).toBeNull();
  });

  it('toasts the failure when an upload fails', async () => {
    uploadImageMock.mockRejectedValue(new Error('Broken pipe'));
    render(<ProductGallery product={product()} editable />);

    pickFiles([imageFile('bad.jpg')]);
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('Broken pipe')),
    );
  });

  // ── Swipe / keyboard carousel navigation (8.27) ─────────────────────────

  it('swiping horizontally moves the selection (LTR: left = next) and stops at the ends', () => {
    render(<ProductGallery product={product()} editable={false} />);

    swipeMain(200, 100); // left → next
    expect(mainSrc()).toContain('img-2');
    swipeMain(200, 100);
    expect(mainSrc()).toContain('img-3');
    swipeMain(200, 100); // already at the last — no wrap-around
    expect(mainSrc()).toContain('img-3');

    swipeMain(100, 200); // right → previous
    expect(mainSrc()).toContain('img-2');
  });

  it('short or mostly-vertical drags never change the selection (page scroll wins)', () => {
    render(<ProductGallery product={product()} editable={false} />);

    swipeMain(100, 80); // 20px — below the threshold
    expect(mainSrc()).toContain('img-1');
    swipeMain(200, 140, 10, 200); // 60px horizontal but 190px vertical dominates
    expect(mainSrc()).toContain('img-1');
  });

  it('a swipe suppresses the click-to-lightbox that follows; a plain click still opens', () => {
    render(<ProductGallery product={product()} editable={false} />);

    swipeMain(200, 100);
    fireEvent.click(screen.getByTestId('product-gallery-main'));
    expect(screen.queryByTestId('viewer-stub')).toBeNull();

    fireEvent.click(screen.getByTestId('product-gallery-main'));
    expect(screen.getByTestId('viewer-stub')).toHaveAttribute('data-initial', '1');
  });

  it('arrow keys move the selection on the main picture', () => {
    render(<ProductGallery product={product()} editable={false} />);
    const main = screen.getByTestId('product-gallery-main');

    fireEvent.keyDown(main, { key: 'ArrowRight' });
    expect(mainSrc()).toContain('img-2');
    fireEvent.keyDown(main, { key: 'ArrowLeft' });
    expect(mainSrc()).toContain('img-1');
    fireEvent.keyDown(main, { key: 'ArrowLeft' }); // at the first — stays
    expect(mainSrc()).toContain('img-1');
  });

  it('inverts swipe and arrow directions under RTL', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    render(<ProductGallery product={product()} editable={false} />);

    fireEvent.click(screen.getByTestId('product-gallery-thumb-1'));
    swipeMain(200, 100); // RTL: swipe left = PREVIOUS
    expect(mainSrc()).toContain('img-1');

    const main = screen.getByTestId('product-gallery-main');
    fireEvent.keyDown(main, { key: 'ArrowLeft' }); // RTL: ArrowLeft = next
    expect(mainSrc()).toContain('img-2');
  });

  it('exposes carousel semantics and politely announces the position', () => {
    render(<ProductGallery product={product()} editable={false} />);

    expect(screen.getByTestId('product-gallery')).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    );
    const position = screen.getByTestId('product-gallery-position');
    expect(position).toHaveAttribute('aria-live', 'polite');
    expect(position).toHaveTextContent('pictureOf:1,3');

    fireEvent.click(screen.getByTestId('product-gallery-thumb-2'));
    expect(position).toHaveTextContent('pictureOf:3,3');
  });

  it('a single-picture gallery has no swipe surface or announcement', () => {
    render(<ProductGallery product={product(1)} editable={false} />);

    expect(screen.queryByTestId('product-gallery-position')).toBeNull();
    swipeMain(200, 100);
    expect(mainSrc()).toContain('img-1');
    // The suppressed-click guard never arms without a swipe — click opens.
    fireEvent.click(screen.getByTestId('product-gallery-main'));
    expect(screen.getByTestId('viewer-stub')).toBeInTheDocument();
  });
});
