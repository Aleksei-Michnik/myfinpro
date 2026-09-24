import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const items = [
  { key: 'all', label: 'All' },
  { key: 'personal', label: 'Personal' },
  { key: 'group:1', label: 'Family', disabled: true },
];

describe('Tabs (20.1)', () => {
  it('renders a labelled tablist and marks the current tab', () => {
    render(
      <Tabs
        items={items}
        current="personal"
        onChange={() => {}}
        ariaLabel="Scope"
        data-testid="scope-tabs"
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Scope' })).toBeInTheDocument();
    const current = screen.getByRole('tab', { name: 'Personal' });
    expect(current).toHaveAttribute('aria-selected', 'true');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.className).toContain('border-primary-600');
    expect(screen.getByTestId('scope-tabs-personal')).toBe(current);
  });

  it('emits the key of another tab only', () => {
    const onChange = vi.fn();
    render(<Tabs items={items} current="all" onChange={onChange} ariaLabel="Scope" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(onChange).toHaveBeenCalledWith('personal');
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('disables a single tab and all of them', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Tabs items={items} current="all" onChange={onChange} ariaLabel="Scope" />,
    );
    expect(screen.getByRole('tab', { name: 'Family' })).toBeDisabled();
    rerender(<Tabs items={items} current="all" onChange={onChange} ariaLabel="Scope" disabled />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute('aria-disabled', 'true');
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('takes a per-item testId override', () => {
    render(
      <Tabs
        items={[{ key: 'all', label: 'All', testId: 'scope-tab-all' }]}
        current="personal"
        onChange={() => {}}
        ariaLabel="Scope"
      />,
    );
    expect(screen.getByTestId('scope-tab-all')).toBeInTheDocument();
  });
});
