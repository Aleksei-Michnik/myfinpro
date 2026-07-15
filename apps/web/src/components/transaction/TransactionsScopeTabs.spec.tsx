import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsScopeTabs } from './TransactionsScopeTabs';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

describe('TransactionsScopeTabs', () => {
  it('renders All + Personal tabs when no groups', () => {
    render(<TransactionsScopeTabs current="all" groups={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId('scope-tab-all')).toBeInTheDocument();
    expect(screen.getByTestId('scope-tab-personal')).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(2);
  });

  it('renders one tab per group', () => {
    render(
      <TransactionsScopeTabs
        current="all"
        groups={[
          { id: 'g-1', name: 'Family' },
          { id: 'g-2', name: 'Roommates' },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('scope-tab-group:g-1')).toHaveTextContent('Family');
    expect(screen.getByTestId('scope-tab-group:g-2')).toHaveTextContent('Roommates');
  });

  it('clicking a non-active tab calls onChange with the new key', () => {
    const onChange = vi.fn();
    render(<TransactionsScopeTabs current="all" groups={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scope-tab-personal'));
    expect(onChange).toHaveBeenCalledWith('personal');
  });

  it('clicking the active tab is a no-op', () => {
    const onChange = vi.fn();
    render(<TransactionsScopeTabs current="all" groups={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scope-tab-all'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Group tab calls onChange with "group:<id>"', () => {
    const onChange = vi.fn();
    render(
      <TransactionsScopeTabs
        current="all"
        groups={[{ id: 'g-1', name: 'Family' }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('scope-tab-group:g-1'));
    expect(onChange).toHaveBeenCalledWith('group:g-1');
  });

  it('active tab has aria-current="page"', () => {
    render(<TransactionsScopeTabs current="personal" groups={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId('scope-tab-personal')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('scope-tab-all')).not.toHaveAttribute('aria-current', 'page');
  });

  it('container has role="tablist" and tabs have role="tab"', () => {
    render(
      <TransactionsScopeTabs
        current="all"
        groups={[{ id: 'g-1', name: 'Family' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('disabled=true blocks click handlers and sets aria-disabled', () => {
    const onChange = vi.fn();
    render(<TransactionsScopeTabs current="all" groups={[]} onChange={onChange} disabled />);
    expect(screen.getByTestId('scope-tab-personal')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('scope-tab-personal')).toBeDisabled();
    fireEvent.click(screen.getByTestId('scope-tab-personal'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tabs are <button> elements (not anchors) — orchestrator owns URL writes', () => {
    render(<TransactionsScopeTabs current="all" groups={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId('scope-tab-all').tagName).toBe('BUTTON');
    expect(screen.getByTestId('scope-tab-personal').tagName).toBe('BUTTON');
  });
});
