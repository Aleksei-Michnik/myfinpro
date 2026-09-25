import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Textarea } from './Textarea';

describe('Textarea (20.1)', () => {
  it('renders a labelled textarea bound to its name', () => {
    render(<Textarea name="note" label="Note" rows={3} />);
    const field = screen.getByRole('textbox', { name: 'Note' });
    expect(field).toHaveAttribute('id', 'note');
    expect(field).toHaveAttribute('rows', '3');
  });

  it('surfaces an error as an alert wired through aria-describedby', () => {
    render(<Textarea name="note" label="Note" error="Too long" />);
    const field = screen.getByRole('textbox');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('aria-describedby', 'note-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Too long');
  });

  it('forwards the ref and the change handler', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const onChange = vi.fn();
    render(<Textarea ref={ref} name="note" onChange={onChange} data-testid="note-field" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    fireEvent.change(screen.getByTestId('note-field'), { target: { value: 'hi' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('shares the control styles with the other fields, in both colour schemes', () => {
    render(<Textarea name="note" size="sm" />);
    const field = screen.getByRole('textbox');
    expect(field.className).toContain('px-2 py-1.5');
    expect(field.className).toContain('dark:bg-gray-800');
  });
});
