import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
  });

  it('renders children text', () => {
    render(<Button>Submit</Button>);
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('renders as a <button> HTML element', () => {
    render(<Button>Element</Button>);
    const button = screen.getByRole('button', { name: 'Element' });
    expect(button.tagName).toBe('BUTTON');
  });

  describe('variant classes', () => {
    it('applies primary variant classes by default', () => {
      render(<Button>Primary</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-primary-600');
      expect(button.className).toContain('text-white');
      // Phase 6 · Iteration 6.16.5 — explicit dark-mode contrast.
      expect(button.className).toContain('dark:bg-primary-500');
    });

    it('applies secondary variant classes', () => {
      render(<Button variant="secondary">Secondary</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-gray-200');
      expect(button.className).toContain('text-gray-800');
      expect(button.className).toContain('dark:bg-gray-700');
      expect(button.className).toContain('dark:text-gray-100');
    });

    it('applies outline variant classes', () => {
      render(<Button variant="outline">Outline</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('border-primary-600');
      expect(button.className).toContain('text-primary-600');
      expect(button.className).toContain('dark:border-primary-400');
      expect(button.className).toContain('dark:text-primary-300');
    });

    it('applies danger variant classes (solid red, white text — WCAG-AA contrast)', () => {
      render(<Button variant="danger">Delete</Button>);
      const button = screen.getByRole('button');
      // Solid red background + white foreground — same contrast level as primary.
      expect(button.className).toContain('bg-red-600');
      expect(button.className).toContain('text-white');
      // Dark-mode adjustment.
      expect(button.className).toContain('dark:bg-red-500');
      // Must NOT use the low-contrast tinted treatment.
      expect(button.className).not.toMatch(/text-red-300/);
      expect(button.className).not.toMatch(/bg-red-500\/10/);
    });

    it('danger variant is not visually disabled when idle', () => {
      render(<Button variant="danger">Delete</Button>);
      const button = screen.getByRole('button');
      expect(button).not.toBeDisabled();
      // Idle danger button must read as enabled — no opacity/cursor modifier
      // is *active* (the disabled: prefix only kicks in when [disabled]).
      expect(button.getAttribute('aria-disabled')).not.toBe('true');
    });
  });

  describe('size classes', () => {
    it('applies md size classes by default', () => {
      render(<Button>Medium</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('px-4');
      expect(button.className).toContain('py-2');
      expect(button.className).toContain('text-base');
    });

    it('applies sm size classes', () => {
      render(<Button size="sm">Small</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('px-3');
      expect(button.className).toContain('py-1.5');
      expect(button.className).toContain('text-sm');
    });

    it('applies lg size classes', () => {
      render(<Button size="lg">Large</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toContain('px-6');
      expect(button.className).toContain('py-3');
      expect(button.className).toContain('text-lg');
    });
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  describe('disabled state', () => {
    it('applies disabled styles when disabled', () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button.className).toContain('disabled:opacity-50');
      expect(button.className).toContain('disabled:cursor-not-allowed');
    });

    it('does not fire click handler when disabled', () => {
      const handleClick = vi.fn();
      render(
        <Button disabled onClick={handleClick}>
          Disabled
        </Button>,
      );

      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  it('merges custom className with default classes', () => {
    render(<Button className="my-custom-class">Custom</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('my-custom-class');
    // Default classes should still be present
    expect(button.className).toContain('inline-flex');
    expect(button.className).toContain('rounded-md');
  });
});
