import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge (20.1)', () => {
  it('renders a neutral chip by default, with a dark variant', () => {
    render(<Badge data-testid="chip">Personal</Badge>);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent('Personal');
    expect(chip.className).toContain('rounded-full');
    expect(chip.className).toContain('bg-gray-100');
    expect(chip.className).toContain('dark:bg-gray-700');
  });

  it('carries a colour per tone', () => {
    const { rerender } = render(<Badge data-testid="chip" tone="success" />);
    expect(screen.getByTestId('chip').className).toContain('bg-green-100');
    rerender(<Badge data-testid="chip" tone="danger" />);
    expect(screen.getByTestId('chip').className).toContain('bg-red-100');
    rerender(<Badge data-testid="chip" tone="warning" />);
    expect(screen.getByTestId('chip').className).toContain('bg-amber-100');
    rerender(<Badge data-testid="chip" tone="primary" />);
    expect(screen.getByTestId('chip').className).toContain('bg-primary-100');
  });

  it('switches padding by size and keeps native attributes', () => {
    render(
      <Badge data-testid="chip" size="md" title="Partial totals">
        99
      </Badge>,
    );
    const chip = screen.getByTestId('chip');
    expect(chip.className).toContain('px-2.5');
    expect(chip).toHaveAttribute('title', 'Partial totals');
  });
});
