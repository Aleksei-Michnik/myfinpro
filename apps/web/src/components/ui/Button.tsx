import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

// Phase 6 · Iteration 6.16.5 — added the `danger` variant for destructive
// actions (e.g., Delete). Foreground/background pair is solid white-on-red,
// matching the contrast level of `primary` so the button is clearly readable
// against both light and dark surfaces (WCAG-AA). Avoid the previous
// low-contrast tinted treatment (`text-red-300 bg-red-500/10`) which left
// the button looking disabled when idle.
//
// Every variant carries explicit `dark:` overrides so the button reads
// correctly on both surfaces. Solid variants (primary / danger) keep
// white text but switch to the lighter 500 shade on dark mode for a more
// vibrant pop; tinted variants (secondary / outline) flip the gray ramp
// and dial back hover to a translucent overlay.
const variantStyles = {
  primary:
    'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500 dark:bg-primary-500 dark:hover:bg-primary-600',
  secondary:
    'bg-gray-200 text-gray-800 hover:bg-gray-300 focus:ring-gray-400 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600',
  outline:
    'border border-primary-600 text-primary-600 hover:bg-primary-50 focus:ring-primary-500 dark:border-primary-400 dark:text-primary-300 dark:hover:bg-primary-900/30',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 dark:bg-red-500 dark:hover:bg-red-600',
};

const sizeStyles = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

/**
 * Basic reusable button component.
 * Will be extended with more variants and states in later phases.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
