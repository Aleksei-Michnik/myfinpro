import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

const onClose = vi.fn();

const messages = { ui: { dialog: { close: 'Close' } } };

const renderDialog = (over: Partial<Parameters<typeof Dialog>[0]> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Dialog open onClose={onClose} title="Edit budget" testId="test-dialog" {...over}>
        <p>Body text</p>
        <button type="button">Inner action</button>
      </Dialog>
    </NextIntlClientProvider>,
  );

describe('Dialog (20.1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders modal semantics labelled by its title', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'test-dialog-title');
    expect(screen.getByRole('heading', { name: 'Edit budget' })).toHaveAttribute(
      'id',
      'test-dialog-title',
    );
    expect(screen.getByTestId('test-dialog')).toBe(dialog);
  });

  it('renders nothing while closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on ESC and on a backdrop mousedown, but not on one inside the panel', () => {
    renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId('test-dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByText('Body text'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('honours closeOnBackdrop={false}', () => {
    renderDialog({ closeOnBackdrop: false });
    fireEvent.mouseDown(screen.getByTestId('test-dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll while open and releases on unmount', () => {
    const { unmount } = renderDialog();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('moves focus into the dialog and restores it on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = renderDialog();
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('focuses initialFocusRef when given', async () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Dialog open onClose={onClose} title="Pick" testId="focus-dialog" initialFocusRef={ref}>
          <button type="button" ref={ref} data-testid="wanted">
            Wanted
          </button>
        </Dialog>
      </NextIntlClientProvider>,
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('wanted')));
  });

  it('traps Tab inside the dialog', () => {
    renderDialog();
    const inner = screen.getByRole('button', { name: 'Inner action' });
    inner.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(inner);
  });

  it('marks aria-busy while busy and tones the title for danger', () => {
    renderDialog({ busy: true, danger: true });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: 'Edit budget' }).className).toContain(
      'text-red-600',
    );
  });

  it('the sheet variant carries a labelled close button; the panel variant does not', () => {
    const { unmount } = renderDialog({ variant: 'sheet' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('renders a footer after the children', () => {
    renderDialog({ footer: <span data-testid="dialog-footer">Footer</span> });
    expect(screen.getByTestId('dialog-footer')).toBeInTheDocument();
  });

  it('falls back to labelledBy and ariaLabel when no title is given', () => {
    const { unmount } = renderDialog({ title: undefined, labelledBy: 'external-heading' });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'external-heading');
    unmount();
    renderDialog({ title: undefined, ariaLabel: 'Receipt viewer' });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Receipt viewer');
  });
});
