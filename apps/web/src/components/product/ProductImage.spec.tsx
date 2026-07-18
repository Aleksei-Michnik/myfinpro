import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductImage } from './ProductImage';

describe('ProductImage (8.27)', () => {
  it('renders a lazy, async-decoded <img> for a src', () => {
    render(<ProductImage src="/api/v1/products/p-1/image?v=v1" alt="Milk" className="h-5 w-5" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/api/v1/products/p-1/image?v=v1');
    expect(img).toHaveAttribute('alt', 'Milk');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img.className).toContain('h-5 w-5');
  });

  it('renders the cube placeholder when there is no src', () => {
    render(<ProductImage src={null} placeholderClassName="h-10 w-10" />);
    const cube = screen.getByTestId('product-image-placeholder');
    expect(cube.getAttribute('class')).toContain('h-10 w-10');
  });

  it('swaps to the placeholder on a load error, then retries on a new src', () => {
    const { container, rerender } = render(<ProductImage src="/img?v=1" />);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();

    // A new URL (?v= bump / rendition finished processing) gets a fresh attempt.
    rerender(<ProductImage src="/img?v=2" />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/img?v=2');
  });
});
