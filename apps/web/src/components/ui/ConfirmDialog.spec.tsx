import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const onConfirm = vi.fn();
const onClose = vi.fn();

const renderDialog = (over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) =>
  render(
    <ConfirmDialog
      title="Remove picture"
      message="Really remove?"
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onClose={onClose}
      {...over}
    />,
  );

describe('ConfirmDialog (8.27)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders title, message and labelled buttons with dialog semantics', () => {
    renderDialog();
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
    expect(screen.getByText('Remove picture')).toBeInTheDocument();
    expect(screen.getByText('Really remove?')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Delete');
    expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Cancel');
  });

  it('confirm fires onConfirm (and only that)', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel, ESC and backdrop mousedown all close without confirming', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('confirm-dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a mousedown inside the panel does not close', () => {
    renderDialog();
    fireEvent.mouseDown(screen.getByText('Really remove?'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('danger turns the confirm button red', () => {
    renderDialog({ danger: true });
    expect(screen.getByTestId('confirm-dialog-confirm').className).toContain('!bg-red-600');
  });

  it('busy disables confirm and shows the spinner', () => {
    renderDialog({ busy: true });
    const confirm = screen.getByTestId('confirm-dialog-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm.querySelector('[data-testid="button-spinner"]')).toBeTruthy();
  });
});
