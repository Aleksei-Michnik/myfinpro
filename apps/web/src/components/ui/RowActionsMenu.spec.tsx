import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RowActionsMenu, type RowActionsMenuItem } from './RowActionsMenu';

function makeItems(overrides: Partial<RowActionsMenuItem>[] = []): RowActionsMenuItem[] {
  const onEdit = overrides[0]?.onClick ?? vi.fn();
  const onDelete = overrides[1]?.onClick ?? vi.fn();
  return [
    { key: 'edit', label: 'Edit', onClick: onEdit, testId: 'item-edit', ...overrides[0] },
    {
      key: 'delete',
      label: 'Delete',
      destructive: true,
      onClick: onDelete,
      testId: 'item-delete',
      ...overrides[1],
    },
  ];
}

describe('RowActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the trigger with the supplied aria-label', () => {
    render(<RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />);
    const btn = screen.getByTestId('trigger');
    expect(btn).toHaveAttribute('aria-label', 'Row actions');
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the popover on trigger click and flips aria-expanded', () => {
    render(<RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('trigger')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('renders all items with their labels', () => {
    render(<RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('clicking an item invokes its onClick and closes the menu', () => {
    const onEdit = vi.fn();
    const items = makeItems([{ onClick: onEdit }]);
    render(<RowActionsMenu triggerLabel="Row actions" items={items} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(screen.getByTestId('item-edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('destructive item gets danger styling', () => {
    render(<RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('item-delete').className).toMatch(/red/);
    expect(screen.getByTestId('item-edit').className).not.toMatch(/red/);
  });

  it('disabled item does not fire onClick and has the disabled attribute', () => {
    const onEdit = vi.fn();
    const items = makeItems([{ onClick: onEdit, disabled: true }]);
    render(<RowActionsMenu triggerLabel="Row actions" items={items} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    const item = screen.getByTestId('item-edit');
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('clicking outside closes the popover', () => {
    render(
      <div>
        <RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />
        <span data-testid="outside">outside</span>
      </div>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes the popover', () => {
    render(<RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('trigger click does not bubble to a parent onClick handler', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />
      </div>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('popover is rendered into document.body via portal', () => {
    render(
      <section data-testid="host">
        <RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />
      </section>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    const menu = screen.getByRole('menu');
    expect(menu.closest('[data-testid="host"]')).toBeNull();
    // The portal target is document.body — assert the menu's nearest ancestor
    // outside the React tree is body itself.
    let parent: HTMLElement | null = menu;
    while (parent && parent.parentElement && parent.parentElement !== document.body) {
      parent = parent.parentElement;
    }
    expect(parent?.parentElement).toBe(document.body);
  });

  it('clicking the trigger again closes an open popover (toggle)', () => {
    render(<RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('exposes a popover testId derived from the trigger testId', () => {
    render(<RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('trigger-popover')).toBeInTheDocument();
  });

  it('clicking an item does not bubble to a parent onClick handler', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <RowActionsMenu triggerLabel="Row actions" items={makeItems()} testId="trigger" />
      </div>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    parentClick.mockClear();
    fireEvent.click(screen.getByTestId('item-edit'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
