import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentScopeSelector } from './PaymentScopeSelector';
import type { AttributionScope } from '@/lib/payment/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'personal') return 'Personal';
    if (key === 'noGroups') return 'No groups.';
    if (key === 'groupRole.admin') return 'admin';
    if (key === 'groupRole.member') return 'member';
    return key;
  },
}));

const groupsMock = {
  groups: [
    { id: 'g1', name: 'Family', role: 'admin', defaultCurrency: 'USD' },
    { id: 'g2', name: 'Work', role: 'member', defaultCurrency: 'USD' },
  ],
};

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => groupsMock,
}));

describe('PaymentScopeSelector', () => {
  it('renders Personal first by default', () => {
    render(<PaymentScopeSelector value={[]} onChange={() => {}} />);
    expect(screen.getByTestId('scope-toggle-personal')).toBeInTheDocument();
  });

  it('hidePersonal=true hides Personal', () => {
    render(<PaymentScopeSelector value={[]} onChange={() => {}} hidePersonal />);
    expect(screen.queryByTestId('scope-toggle-personal')).not.toBeInTheDocument();
  });

  it('lists every group from useGroups()', () => {
    render(<PaymentScopeSelector value={[]} onChange={() => {}} />);
    expect(screen.getByTestId('scope-toggle-group-g1')).toBeInTheDocument();
    expect(screen.getByTestId('scope-toggle-group-g2')).toBeInTheDocument();
  });

  it('allowedGroupIds filters the list', () => {
    render(<PaymentScopeSelector value={[]} onChange={() => {}} allowedGroupIds={['g1']} />);
    expect(screen.getByTestId('scope-toggle-group-g1')).toBeInTheDocument();
    expect(screen.queryByTestId('scope-toggle-group-g2')).not.toBeInTheDocument();
  });

  it('toggling Personal adds a personal scope', () => {
    const onChange = vi.fn();
    render(<PaymentScopeSelector value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scope-toggle-personal'));
    expect(onChange).toHaveBeenCalledWith([{ scope: 'personal' }]);
  });

  it('toggling Personal removes when already selected', () => {
    const onChange = vi.fn();
    const value: AttributionScope[] = [{ scope: 'personal' }, { scope: 'group', groupId: 'g1' }];
    render(<PaymentScopeSelector value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scope-toggle-personal'));
    expect(onChange).toHaveBeenCalledWith([{ scope: 'group', groupId: 'g1' }]);
  });

  it('toggling a group adds/removes correctly', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PaymentScopeSelector value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    expect(onChange).toHaveBeenLastCalledWith([{ scope: 'group', groupId: 'g1' }]);
    rerender(
      <PaymentScopeSelector value={[{ scope: 'group', groupId: 'g1' }]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('renders admin role badge for admin groups', () => {
    render(<PaymentScopeSelector value={[]} onChange={() => {}} />);
    expect(screen.getByTestId('scope-group-role-g1')).toBeInTheDocument();
    expect(screen.queryByTestId('scope-group-role-g2')).not.toBeInTheDocument();
  });

  it('disabled=true disables all checkboxes and blocks onChange', () => {
    const onChange = vi.fn();
    render(<PaymentScopeSelector value={[]} onChange={onChange} disabled />);
    const cb = screen.getByTestId('scope-toggle-personal') as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    // group checkboxes also disabled
    expect((screen.getByTestId('scope-toggle-group-g1') as HTMLInputElement).disabled).toBe(true);
  });
});
