import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card (20.1)', () => {
  it('renders a div with the shared shell in both colour schemes', () => {
    render(<Card data-testid="card">Body</Card>);
    const card = screen.getByTestId('card');
    expect(card.tagName).toBe('DIV');
    expect(card.className).toContain('rounded-lg');
    expect(card.className).toContain('border-gray-200');
    expect(card.className).toContain('dark:bg-gray-800');
    expect(card).toHaveTextContent('Body');
  });

  it('renders as another element for lists and sections', () => {
    render(
      <ul>
        <Card as="li" data-testid="row">
          Row
        </Card>
      </ul>,
    );
    expect(screen.getByTestId('row').tagName).toBe('LI');
  });

  it('maps the padding scale and the muted surface', () => {
    const { rerender } = render(<Card data-testid="card" padding="sm" />);
    expect(screen.getByTestId('card').className).toContain('p-4');
    rerender(<Card data-testid="card" padding="lg" muted />);
    expect(screen.getByTestId('card').className).toContain('p-6');
    expect(screen.getByTestId('card').className).toContain('bg-gray-50');
  });

  it('passes native attributes and extra classes through', () => {
    render(<Card data-testid="card" className="space-y-2" aria-labelledby="heading" id="totals" />);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('space-y-2');
    expect(card).toHaveAttribute('aria-labelledby', 'heading');
    expect(card).toHaveAttribute('id', 'totals');
  });
});
