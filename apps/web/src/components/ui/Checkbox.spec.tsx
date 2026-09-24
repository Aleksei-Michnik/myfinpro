import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox (20.1)', () => {
  it('labels the box with its text and toggles through the label', () => {
    const onChange = vi.fn();
    render(<Checkbox name="consent" label="I agree" onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: /I agree/ });
    fireEvent.click(screen.getByText('I agree'));
    expect(onChange).toHaveBeenCalled();
    expect(box).toHaveAttribute('type', 'checkbox');
  });

  it('aligns the box with the label text on demand', () => {
    const { container } = render(<Checkbox name="scope" label="Personal" align="center" />);
    expect(container.querySelector('label')!.className).toContain('items-center');
    expect(screen.getByRole('checkbox').className).not.toContain('mt-0.5');
  });

  it('renders an optional description', () => {
    render(<Checkbox name="alerts" label="Alert me" description="When the budget overruns" />);
    expect(screen.getByText('When the budget overruns')).toBeInTheDocument();
  });

  it('surfaces an error as an alert wired through aria-describedby', () => {
    render(<Checkbox name="consent" label="I agree" error="Required" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-describedby', 'consent-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('forwards the ref, checked state and disabled', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Checkbox
        ref={ref}
        name="consent"
        label="I agree"
        checked
        disabled
        onChange={() => {}}
        data-testid="consent-checkbox"
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    const box = screen.getByTestId('consent-checkbox');
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(box.className).toContain('dark:');
  });
});
