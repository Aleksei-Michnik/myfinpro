import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('renders an SVG with role="img" and aria-hidden="true"', () => {
    render(<Spinner data-testid="s" />);
    const svg = screen.getByTestId('s');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies the requested size via width/height', () => {
    const { rerender } = render(<Spinner size="sm" data-testid="s" />);
    expect(screen.getByTestId('s').getAttribute('width')).toBe('12');
    rerender(<Spinner size="lg" data-testid="s" />);
    expect(screen.getByTestId('s').getAttribute('width')).toBe('32');
  });

  it('exposes a stable mfp-spinner class that the reduced-motion media query targets', () => {
    render(<Spinner data-testid="s" />);
    // SVG `className` is an SVGAnimatedString in jsdom — read the attribute directly.
    expect(screen.getByTestId('s').getAttribute('class')).toContain('mfp-spinner');
  });
});
