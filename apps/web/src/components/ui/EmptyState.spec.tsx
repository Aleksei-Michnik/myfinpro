import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState (20.1)', () => {
  it('renders the title in a dashed frame by default', () => {
    render(<EmptyState title="No budgets yet" data-testid="budgets-empty" />);
    const block = screen.getByTestId('budgets-empty');
    expect(block).toHaveTextContent('No budgets yet');
    expect(block.className).toContain('border-dashed');
    expect(block.className).toContain('dark:border-gray-600');
  });

  it('renders description, icon and action', () => {
    render(
      <EmptyState
        title="Nothing here"
        description="Add your first one"
        icon={<span aria-hidden="true">•</span>}
        action={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByText('Add your first one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('drops the frame inside a card and leaves the rhythm to the caller', () => {
    render(
      <EmptyState title="No activity" bordered={false} className="py-4" data-testid="empty" />,
    );
    const block = screen.getByTestId('empty');
    expect(block.className).not.toContain('border-dashed');
    expect(block.className).not.toContain('p-10');
    expect(block.className).toContain('py-4');
  });
});
