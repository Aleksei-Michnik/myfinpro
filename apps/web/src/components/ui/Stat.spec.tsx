import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stat } from './Stat';

describe('Stat (20.1)', () => {
  it('renders a label, a value and an optional hint', () => {
    render(
      <Stat
        label="Net"
        value="₪120.00"
        hint="this month"
        data-testid="net"
        valueTestId="net-value"
      />,
    );
    expect(screen.getByTestId('net')).toHaveTextContent('Net');
    expect(screen.getByTestId('net-value')).toHaveTextContent('₪120.00');
    expect(screen.getByText('this month')).toBeInTheDocument();
  });

  it('tones the value and keeps a dark variant', () => {
    const { rerender } = render(<Stat label="In" value="1" tone="positive" valueTestId="v" />);
    expect(screen.getByTestId('v').className).toContain('text-green-700');
    expect(screen.getByTestId('v').className).toContain('dark:text-green-400');
    rerender(<Stat label="Out" value="1" tone="negative" valueTestId="v" />);
    expect(screen.getByTestId('v').className).toContain('text-red-700');
  });

  it('shrinks the value in dense rows', () => {
    render(<Stat label="In" value="1" size="sm" valueTestId="v" />);
    expect(screen.getByTestId('v').className).toContain('text-sm');
  });
});
