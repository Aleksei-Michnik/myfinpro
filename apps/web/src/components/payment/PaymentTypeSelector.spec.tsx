import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentTypeSelector } from './PaymentTypeSelector';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('PaymentTypeSelector', () => {
  it('advanced list is collapsed by default', () => {
    render(<PaymentTypeSelector value="ONE_TIME" onChange={() => {}} />);
    expect(screen.queryByTestId('type-advanced-list')).not.toBeInTheDocument();
  });

  it('disclosure expands the advanced list on click', () => {
    render(<PaymentTypeSelector value="ONE_TIME" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
    expect(screen.getByTestId('type-advanced-list')).toBeInTheDocument();
  });

  it('ONE_TIME radio is enabled', () => {
    render(<PaymentTypeSelector value="ONE_TIME" onChange={() => {}} />);
    const radio = screen.getByTestId('type-radio-ONE_TIME') as HTMLInputElement;
    expect(radio.disabled).toBe(false);
  });

  it('still-disabled advanced radios carry aria-disabled', () => {
    render(<PaymentTypeSelector value="ONE_TIME" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
    for (const t of ['LIMITED_PERIOD', 'INSTALLMENT', 'LOAN', 'MORTGAGE']) {
      const el = screen.getByTestId(`type-radio-${t}`) as HTMLInputElement;
      expect(el.disabled).toBe(true);
      expect(el).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('RECURRING radio is enabled in 6.18.1', () => {
    render(<PaymentTypeSelector value="ONE_TIME" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
    const radio = screen.getByTestId('type-radio-RECURRING') as HTMLInputElement;
    expect(radio.disabled).toBe(false);
    expect(screen.queryByTestId('type-badge-RECURRING')).not.toBeInTheDocument();
  });

  it('still-disabled options render the coming-soon badge', () => {
    render(<PaymentTypeSelector value="ONE_TIME" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
    expect(screen.getByTestId('type-badge-INSTALLMENT')).toBeInTheDocument();
    expect(screen.getByTestId('type-badge-MORTGAGE')).toBeInTheDocument();
  });

  it('clicking RECURRING fires onChange with RECURRING', () => {
    const onChange = vi.fn();
    render(<PaymentTypeSelector value="ONE_TIME" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
    fireEvent.click(screen.getByTestId('type-radio-RECURRING'));
    expect(onChange).toHaveBeenCalledWith('RECURRING');
  });

  it('clicking a still-disabled advanced radio does not fire onChange', () => {
    const onChange = vi.fn();
    render(<PaymentTypeSelector value="ONE_TIME" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
    fireEvent.change(screen.getByTestId('type-radio-INSTALLMENT'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled=true disables the ONE_TIME radio', () => {
    render(<PaymentTypeSelector value="ONE_TIME" onChange={() => {}} disabled />);
    const radio = screen.getByTestId('type-radio-ONE_TIME') as HTMLInputElement;
    expect(radio.disabled).toBe(true);
  });
});
