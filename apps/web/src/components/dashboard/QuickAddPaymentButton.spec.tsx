import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickAddPaymentButton } from './QuickAddPaymentButton';

const dialogProps = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/payment/PaymentFormDialog', () => ({
  PaymentFormDialog: (props: Record<string, unknown>) => {
    dialogProps(props);
    return (
      <div data-testid="mocked-payment-form-dialog">
        <button
          type="button"
          data-testid="mocked-form-save"
          onClick={() => (props.onSaved as (p: unknown) => void)({ id: 'new-1' })}
        >
          save
        </button>
        <button
          type="button"
          data-testid="mocked-form-close"
          onClick={() => (props.onClose as () => void)()}
        >
          close
        </button>
      </div>
    );
  },
}));

describe('QuickAddPaymentButton', () => {
  it('renders the button visible by default', () => {
    render(<QuickAddPaymentButton />);
    expect(screen.getByTestId('quick-add-payment-button')).toBeInTheDocument();
  });

  it('does not render the dialog until the button is clicked', () => {
    render(<QuickAddPaymentButton />);
    expect(screen.queryByTestId('mocked-payment-form-dialog')).not.toBeInTheDocument();
  });

  it('clicking the button opens the dialog', () => {
    render(<QuickAddPaymentButton />);
    fireEvent.click(screen.getByTestId('quick-add-payment-button'));
    expect(screen.getByTestId('mocked-payment-form-dialog')).toBeInTheDocument();
  });

  it('opens the dialog in mode="create"', () => {
    dialogProps.mockClear();
    render(<QuickAddPaymentButton />);
    fireEvent.click(screen.getByTestId('quick-add-payment-button'));
    expect(dialogProps.mock.calls[0]![0]).toMatchObject({ open: true, mode: 'create' });
  });

  it('after onSaved fires, calls onPaymentCreated and closes the dialog', () => {
    const onCreated = vi.fn();
    render(<QuickAddPaymentButton onPaymentCreated={onCreated} />);
    fireEvent.click(screen.getByTestId('quick-add-payment-button'));
    fireEvent.click(screen.getByTestId('mocked-form-save'));
    expect(onCreated).toHaveBeenCalledWith({ id: 'new-1' });
    expect(screen.queryByTestId('mocked-payment-form-dialog')).not.toBeInTheDocument();
  });

  it('clicking close on the dialog closes without invoking onPaymentCreated', () => {
    const onCreated = vi.fn();
    render(<QuickAddPaymentButton onPaymentCreated={onCreated} />);
    fireEvent.click(screen.getByTestId('quick-add-payment-button'));
    fireEvent.click(screen.getByTestId('mocked-form-close'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mocked-payment-form-dialog')).not.toBeInTheDocument();
  });
});
