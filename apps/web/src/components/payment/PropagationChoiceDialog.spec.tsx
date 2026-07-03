import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PropagationChoiceDialog } from './PropagationChoiceDialog';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.count === 'number') return `${key}:${values.count}`;
    return key;
  },
}));

function renderDialog(props: Partial<React.ComponentProps<typeof PropagationChoiceDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <PropagationChoiceDialog open onConfirm={onConfirm} onCancel={onCancel} {...props} />,
  );
  return { onConfirm, onCancel, view };
}

describe('PropagationChoiceDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId('propagation-choice-dialog')).not.toBeInTheDocument();
  });

  it('renders the three modes with self selected by default', () => {
    renderDialog();
    expect(screen.getByTestId('propagation-choice-dialog')).toBeInTheDocument();
    expect((screen.getByTestId('propagation-mode-self') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('propagation-mode-future') as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByTestId('propagation-mode-all') as HTMLInputElement).checked).toBe(false);
  });

  it('confirm reports the default mode (self)', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId('propagation-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('self');
  });

  it('confirm reports a picked mode', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId('propagation-mode-all'));
    fireEvent.click(screen.getByTestId('propagation-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('all');
  });

  it('cancel button calls onCancel', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId('propagation-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('ESC calls onCancel', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('backdrop mousedown cancels; clicks inside do not', () => {
    const { onCancel } = renderDialog();
    fireEvent.mouseDown(screen.getByTestId('propagation-choice-dialog'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId('propagation-confirm'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('pending disables all inputs and marks the dialog busy', () => {
    const { onConfirm } = renderDialog({ pending: true });
    expect(screen.getByTestId('propagation-choice-dialog').getAttribute('aria-busy')).toBe('true');
    expect((screen.getByTestId('propagation-mode-self') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('propagation-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('propagation-cancel') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('propagation-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('destructive renders the data-loss warning; default does not', () => {
    const { view } = renderDialog();
    expect(screen.queryByTestId('propagation-destructive-warning')).not.toBeInTheDocument();
    view.unmount();
    renderDialog({ destructive: true });
    expect(screen.getByTestId('propagation-destructive-warning')).toBeInTheDocument();
  });

  it('reopening resets the selection to self', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <PropagationChoiceDialog open onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId('propagation-mode-future'));
    expect((screen.getByTestId('propagation-mode-future') as HTMLInputElement).checked).toBe(true);
    rerender(<PropagationChoiceDialog open={false} onConfirm={onConfirm} onCancel={onCancel} />);
    rerender(<PropagationChoiceDialog open onConfirm={onConfirm} onCancel={onCancel} />);
    expect((screen.getByTestId('propagation-mode-self') as HTMLInputElement).checked).toBe(true);
  });
});
