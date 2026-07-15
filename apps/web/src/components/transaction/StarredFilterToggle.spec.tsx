import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StarredFilterToggle } from './StarredFilterToggle';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

describe('StarredFilterToggle', () => {
  it('renders the unfilled icon when starred=false', () => {
    render(<StarredFilterToggle starred={false} onChange={() => {}} />);
    expect(screen.getByTestId('starred-filter-toggle')).toHaveTextContent('☆');
  });

  it('renders the filled icon when starred=true', () => {
    render(<StarredFilterToggle starred={true} onChange={() => {}} />);
    expect(screen.getByTestId('starred-filter-toggle')).toHaveTextContent('★');
  });

  it('aria-pressed reflects starred state', () => {
    const { rerender } = render(<StarredFilterToggle starred={false} onChange={() => {}} />);
    expect(screen.getByTestId('starred-filter-toggle')).toHaveAttribute('aria-pressed', 'false');
    rerender(<StarredFilterToggle starred={true} onChange={() => {}} />);
    expect(screen.getByTestId('starred-filter-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking calls onChange with !starred', () => {
    const fn = vi.fn();
    const { rerender } = render(<StarredFilterToggle starred={false} onChange={fn} />);
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    expect(fn).toHaveBeenCalledWith(true);
    rerender(<StarredFilterToggle starred={true} onChange={fn} />);
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    expect(fn).toHaveBeenLastCalledWith(false);
  });
});
