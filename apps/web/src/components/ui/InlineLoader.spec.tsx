import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineLoader } from './InlineLoader';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

describe('InlineLoader', () => {
  it('renders the spinner and the label side-by-side', () => {
    render(<InlineLoader label="Loading…" />);
    expect(screen.getByTestId('inline-loader')).toHaveTextContent('Loading…');
  });

  it('has aria-live="polite" and aria-busy="true" for screen readers', () => {
    render(<InlineLoader label="Loading…" />);
    const root = screen.getByTestId('inline-loader');
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(root.getAttribute('role')).toBe('status');
  });

  it('omits the label when not provided', () => {
    render(<InlineLoader />);
    const root = screen.getByTestId('inline-loader');
    // The only child should be the spinner SVG.
    expect(root.querySelectorAll('span').length).toBe(0);
  });
});
