import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const options = (
  <>
    <option value="ils">ILS</option>
    <option value="usd">USD</option>
  </>
);

describe('Select (20.1)', () => {
  it('renders a labelled select bound to its name', () => {
    render(
      <Select name="currency" label="Currency">
        {options}
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Currency' });
    expect(select).toHaveAttribute('id', 'currency');
    expect(screen.getByText('Currency').tagName).toBe('LABEL');
  });

  it('prefers an explicit id for the label association', () => {
    render(
      <Select name="currency" id="custom" label="Currency">
        {options}
      </Select>,
    );
    expect(screen.getByText('Currency')).toHaveAttribute('for', 'custom');
  });

  it('surfaces an error as an alert wired through aria-describedby', () => {
    render(
      <Select name="currency" label="Currency" error="Pick one">
        {options}
      </Select>,
    );
    const select = screen.getByRole('combobox');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'currency-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Pick one');
    expect(select.className).toContain('border-red-500');
  });

  it('forwards the ref, the change handler and native attributes', () => {
    const ref = createRef<HTMLSelectElement>();
    const onChange = vi.fn();
    render(
      <Select ref={ref} name="currency" onChange={onChange} disabled data-testid="currency-select">
        {options}
      </Select>,
    );
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    const select = screen.getByTestId('currency-select');
    expect(select).toBeDisabled();
    fireEvent.change(select, { target: { value: 'usd' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('carries both colour schemes and switches between the two sizes', () => {
    const { rerender } = render(<Select name="a">{options}</Select>);
    expect(screen.getByRole('combobox').className).toContain('px-3 py-2');
    expect(screen.getByRole('combobox').className).toContain('dark:');
    rerender(
      <Select name="a" size="sm" fullWidth={false}>
        {options}
      </Select>,
    );
    expect(screen.getByRole('combobox').className).toContain('px-2 py-1.5');
    expect(screen.getByRole('combobox').className).not.toContain('w-full');
  });
});
