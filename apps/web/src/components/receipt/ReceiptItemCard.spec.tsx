import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptItemCard, type ItemRow } from './ReceiptItemCard';
import type { ReceiptItem } from '@/lib/receipt/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

// ProductThumb resolves image URLs through the product context.
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({
    imageUrl: (p: { id: string; imageVersion: string | null }) =>
      `/api/v1/products/${p.id}/image${p.imageVersion ? `?v=${p.imageVersion}` : ''}`,
  }),
}));

const onChange = vi.fn();
const onRemove = vi.fn();
const onOpenMatch = vi.fn();
const onOpenProduct = vi.fn();

const row: ItemRow = {
  rawName: 'Milk',
  quantityStr: '2',
  unitPriceStr: '10.00',
  discountStr: '0.50',
  totalStr: '19.50',
  categoryId: 'cat-1',
};

const serverItem: ReceiptItem = {
  id: 'i-1',
  position: 1,
  rawName: 'Milk',
  barcode: null,
  quantity: 2,
  unitPriceCents: 1000,
  discountCents: 50,
  totalCents: 1950,
  categoryId: 'cat-1',
  productId: null,
  productName: null,
  productBrand: null,
  productHasImage: false,
  productImageVersion: null,
  matchStatus: 'PENDING',
  matchCandidates: [],
};

const renderCard = (over: Partial<Parameters<typeof ReceiptItemCard>[0]> = {}) =>
  render(
    <ReceiptItemCard
      index={0}
      row={row}
      serverItem={serverItem}
      editable
      matchable
      categories={[
        { id: 'cat-1', name: 'Groceries' },
        { id: 'cat-2', name: 'Household' },
      ]}
      currency="ILS"
      onChange={onChange}
      onRemove={onRemove}
      onOpenMatch={onOpenMatch}
      onOpenProduct={onOpenProduct}
      {...over}
    />,
  );

describe('ReceiptItemCard (8.24)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders every field — including unit price and discount — with labels', () => {
    renderCard();
    expect(screen.getByTestId('receipt-item-card-0')).toBeInTheDocument();
    expect(screen.getByTestId('item-name-0')).toHaveValue('Milk');
    expect(screen.getByTestId('item-qty-0')).toHaveValue(2);
    expect(screen.getByTestId('item-unit-0')).toHaveValue(10);
    expect(screen.getByTestId('item-discount-0')).toHaveValue(0.5);
    expect(screen.getByTestId('item-total-0')).toHaveValue(19.5);
    expect(screen.getByTestId('item-category-0')).toHaveValue('cat-1');
    // Money labels carry the receipt currency.
    expect(screen.getByText('itemUnitPrice (ILS)')).toBeInTheDocument();
    expect(screen.getByText('itemDiscount (ILS)')).toBeInTheDocument();
    expect(screen.getByText('itemTotal (ILS)')).toBeInTheDocument();
    expect(screen.getByText('itemCategory')).toBeInTheDocument();
  });

  it('omits the currency suffix when the receipt has none', () => {
    renderCard({ currency: null });
    expect(screen.getByText('itemUnitPrice')).toBeInTheDocument();
  });

  it('propagates edits through onChange as ItemRow patches', () => {
    renderCard();
    fireEvent.change(screen.getByTestId('item-name-0'), { target: { value: 'Milk 3%' } });
    expect(onChange).toHaveBeenLastCalledWith({ rawName: 'Milk 3%' });
    fireEvent.change(screen.getByTestId('item-qty-0'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ quantityStr: '3' });
    fireEvent.change(screen.getByTestId('item-unit-0'), { target: { value: '12.34' } });
    expect(onChange).toHaveBeenLastCalledWith({ unitPriceStr: '12.34' });
    fireEvent.change(screen.getByTestId('item-discount-0'), { target: { value: '1.00' } });
    expect(onChange).toHaveBeenLastCalledWith({ discountStr: '1.00' });
    fireEvent.change(screen.getByTestId('item-total-0'), { target: { value: '37.02' } });
    expect(onChange).toHaveBeenLastCalledWith({ totalStr: '37.02' });
    fireEvent.change(screen.getByTestId('item-category-0'), { target: { value: 'cat-2' } });
    expect(onChange).toHaveBeenLastCalledWith({ categoryId: 'cat-2' });
    fireEvent.change(screen.getByTestId('item-category-0'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ categoryId: null });
  });

  it('remove button fires onRemove and disappears when not editable', () => {
    const { unmount } = renderCard();
    fireEvent.click(screen.getByTestId('item-remove-0'));
    expect(onRemove).toHaveBeenCalledTimes(1);
    unmount();
    renderCard({ editable: false });
    expect(screen.queryByTestId('item-remove-0')).toBeNull();
  });

  it('disables every input when editable=false', () => {
    renderCard({ editable: false });
    for (const id of [
      'item-name-0',
      'item-qty-0',
      'item-unit-0',
      'item-discount-0',
      'item-total-0',
      'item-category-0',
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it('the match chip opens the walkthrough on this item id', () => {
    renderCard();
    const chip = screen.getByTestId('item-product-0');
    expect(chip).toHaveTextContent('itemMatchAction');
    fireEvent.click(chip);
    expect(onOpenMatch).toHaveBeenCalledWith('i-1');
  });

  it('an unmatched item shows the printed code on the chip and a placeholder thumbnail', () => {
    renderCard({ serverItem: { ...serverItem, barcode: '7290119381043' } });
    expect(screen.getByTestId('item-product-0')).toHaveTextContent('7290119381043');
    expect(screen.getByTestId('product-thumb-placeholder')).toBeInTheDocument();
  });

  it('a matched item shows the match dot, official name and the product image', () => {
    const { container } = renderCard({
      serverItem: {
        ...serverItem,
        productId: 'p-1',
        productName: 'Milk 3% 1L',
        productHasImage: true,
        productImageVersion: 'v42',
        matchStatus: 'CONFIRMED',
      },
    });
    expect(screen.getByTestId('item-match-0')).toHaveAttribute('title', 'Milk 3% 1L');
    expect(screen.getByTestId('item-product-0')).toHaveTextContent('Milk 3% 1L');
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/v1/products/p-1/image?v=v42',
    );
  });

  // ── 8.27: thumbnail → product quick view ───────────────────────────────

  it("a linked product's thumbnail is a button that opens the quick view", () => {
    renderCard({
      serverItem: {
        ...serverItem,
        productId: 'p-1',
        productName: 'Milk 3% 1L',
        matchStatus: 'CONFIRMED',
      },
    });
    const thumb = screen.getByTestId('item-thumb-0');
    expect(thumb).toHaveAttribute('aria-label', 'openLabel:Milk 3% 1L');
    fireEvent.click(thumb);
    expect(onOpenProduct).toHaveBeenCalledWith('p-1');
  });

  it('the thumbnail stays non-interactive while unmatched', () => {
    renderCard();
    expect(screen.queryByTestId('item-thumb-0')).toBeNull();
    expect(screen.getByTestId('product-thumb-placeholder')).toBeInTheDocument();
  });

  it('hides match dot and chip without server truth (unsaved rows)', () => {
    renderCard({ serverItem: undefined });
    expect(screen.queryByTestId('item-match-0')).toBeNull();
    expect(screen.queryByTestId('item-product-0')).toBeNull();
    // The header thumbnail slot stays (placeholder) for stable layout.
    expect(screen.getByTestId('product-thumb-placeholder')).toBeInTheDocument();
  });

  it('hides the chip when not matchable but keeps the dot', () => {
    renderCard({ matchable: false });
    expect(screen.queryByTestId('item-product-0')).toBeNull();
    expect(screen.getByTestId('item-match-0')).toBeInTheDocument();
  });
});
