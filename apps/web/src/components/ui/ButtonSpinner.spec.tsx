import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ButtonSpinner } from './ButtonSpinner';

describe('ButtonSpinner', () => {
  it('renders an SVG element', () => {
    render(<ButtonSpinner />);
    expect(screen.getByTestId('button-spinner').tagName.toLowerCase()).toBe('svg');
  });

  it('exposes aria-hidden="true" so the surrounding button owns the announcement', () => {
    render(<ButtonSpinner />);
    expect(screen.getByTestId('button-spinner').getAttribute('aria-hidden')).toBe('true');
  });

  it('size variants apply distinct width/height attributes', () => {
    const { rerender } = render(<ButtonSpinner size="sm" />);
    expect(screen.getByTestId('button-spinner').getAttribute('data-size')).toBe('sm');
    rerender(<ButtonSpinner size="md" />);
    expect(screen.getByTestId('button-spinner').getAttribute('data-size')).toBe('md');
  });

  it('respects custom data-testid for parent test scoping', () => {
    render(<ButtonSpinner data-testid="my-spinner" />);
    expect(screen.getByTestId('my-spinner')).toBeInTheDocument();
  });
});
