import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input name="test" />);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });

  it('renders with label', () => {
    render(<Input name="email" label="Email Address" />);
    const label = screen.getByText('Email Address');
    expect(label).toBeInTheDocument();
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'email');
  });

  it('uses id over name for label association', () => {
    render(<Input name="email" id="custom-id" label="Email" />);
    const label = screen.getByText('Email');
    expect(label).toHaveAttribute('for', 'custom-id');
  });

  it('renders error message', () => {
    render(<Input name="email" error="This field is required" />);
    const errorMsg = screen.getByRole('alert');
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent('This field is required');
  });

  it('has aria-invalid="true" when error is present', () => {
    render(<Input name="email" error="Invalid email" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('has aria-invalid="false" when no error', () => {
    render(<Input name="email" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('has aria-describedby pointing to error element when error exists', () => {
    render(<Input name="email" error="Bad email" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-describedby', 'email-error');
    const errorEl = document.getElementById('email-error');
    expect(errorEl).toBeInTheDocument();
  });

  it('does not have aria-describedby when no error', () => {
    render(<Input name="email" />);
    const input = screen.getByRole('textbox');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('forwards ref to input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input name="test" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('applies disabled state', () => {
    render(<Input name="email" disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });

  it('applies error border class when error is present', () => {
    render(<Input name="email" error="Error" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('border-red-500');
  });

  it('applies normal border class when no error', () => {
    render(<Input name="email" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('border-gray-300');
  });

  it('does not render label when not provided', () => {
    render(<Input name="email" />);
    expect(screen.queryByRole('label')).not.toBeInTheDocument();
  });

  it('does not render error when not provided', () => {
    render(<Input name="email" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('merges custom className', () => {
    render(<Input name="email" className="my-custom" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('my-custom');
    expect(input.className).toContain('rounded-md');
  });

  it('passes through additional HTML attributes', () => {
    render(<Input name="email" type="email" placeholder="test@example.com" />);
    const input = screen.getByPlaceholderText('test@example.com');
    expect(input).toHaveAttribute('type', 'email');
  });
});
