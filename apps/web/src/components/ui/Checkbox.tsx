'use client';

// Phase 20 · Iteration 20.1 — THE checkbox: the box, its label and an optional
// description in one labelled row. Extracted from the hand-rolled
// `<label><input type="checkbox" …/><span/></label>` triples.

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { controlErrorClass } from './input-styles';
import { cx } from './styles';

export const checkboxControlClass =
  'h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Text beside the box. */
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  error?: string;
  /** Vertical alignment of the box against the label (`start` for wrapping text). */
  align?: 'start' | 'center';
  /** Classes on the wrapping `<label>`. */
  wrapperClassName?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      description,
      error,
      align = 'start',
      className = '',
      wrapperClassName = '',
      id,
      ...props
    },
    ref,
  ) => {
    const checkboxId = id || props.name;
    const describedBy = error && checkboxId ? `${checkboxId}-error` : undefined;
    return (
      <div>
        <label
          className={cx(
            'flex gap-2 text-sm text-gray-700 dark:text-gray-200',
            align === 'start' ? 'items-start' : 'items-center',
            !props.disabled && 'cursor-pointer',
            wrapperClassName,
          )}
        >
          <input
            ref={ref}
            id={checkboxId}
            type="checkbox"
            className={cx(align === 'start' && 'mt-0.5', checkboxControlClass, className)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy}
            {...props}
          />
          <span>
            <span>{label}</span>
            {description && (
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                {description}
              </span>
            )}
          </span>
        </label>
        {error && (
          <p id={describedBy} className={controlErrorClass} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';
