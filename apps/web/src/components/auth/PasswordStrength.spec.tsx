import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PasswordStrength } from './PasswordStrength';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('PasswordStrength', () => {
  it('renders nothing for empty password', () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.querySelector('[data-testid="password-strength"]')).not.toBeInTheDocument();
  });

  it('shows strength indicator when password is provided', () => {
    render(<PasswordStrength password="a" />);
    expect(screen.getByTestId('password-strength')).toBeInTheDocument();
  });

  it('shows weak strength for short password with only lowercase', () => {
    render(<PasswordStrength password="abc" />);
    // Only lowercase met (1 out of 4 requirements)
    expect(screen.getByText('strengthWeak')).toBeInTheDocument();
  });

  it('shows fair strength for password meeting length + 1 criteria', () => {
    render(<PasswordStrength password="abcdefgh" />);
    // Meets minLength + lowercase = 2 out of 4
    expect(screen.getByText('strengthFair')).toBeInTheDocument();
  });

  it('shows good strength for password meeting 3 criteria', () => {
    render(<PasswordStrength password="Abcdefgh" />);
    // Meets minLength + uppercase + lowercase = 3 out of 4
    expect(screen.getByText('strengthGood')).toBeInTheDocument();
  });

  it('shows strong strength for password meeting all criteria', () => {
    render(<PasswordStrength password="Abcdefg1" />);
    // Meets minLength + uppercase + lowercase + number = 4 out of 4
    expect(screen.getByText('strengthStrong')).toBeInTheDocument();
  });

  it('shows all 4 requirement items', () => {
    render(<PasswordStrength password="a" />);
    expect(screen.getByText('requireMinLength')).toBeInTheDocument();
    expect(screen.getByText('requireUppercase')).toBeInTheDocument();
    expect(screen.getByText('requireLowercase')).toBeInTheDocument();
    expect(screen.getByText('requireNumber')).toBeInTheDocument();
  });

  it('shows checkmark for met requirements and circle for unmet', () => {
    render(<PasswordStrength password="Abcdefg1" />);
    // All requirements met — all should show ✓
    const checks = screen.getAllByText('✓');
    expect(checks).toHaveLength(4);
  });

  it('shows mixed checkmarks for partially met requirements', () => {
    render(<PasswordStrength password="abc" />);
    // Only lowercase is met
    const checks = screen.getAllByText('✓');
    const circles = screen.getAllByText('○');
    expect(checks).toHaveLength(1);
    expect(circles).toHaveLength(3);
  });

  it('has accessible progressbar role', () => {
    render(<PasswordStrength password="test" />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('aria-label', 'passwordStrength');
  });
});
