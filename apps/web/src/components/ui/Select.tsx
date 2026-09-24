'use client';

// Phase 20 · Iteration 20.1 — THE select. Same contract as <Input>: optional
// label, error text wired through `aria-describedby`, ref forwarded, every
// native attribute passed through. The control classes come from
// `input-styles.ts`, shared with <Input> and <Textarea>.

import { forwardRef, type SelectHTMLAttributes } from 'react';
import {
  controlClass,
  controlErrorClass,
  controlLabelClass,
  type ControlSize,
} from './input-styles';

// `size` is redefined: the native numeric `size` attribute is not used
// anywhere in this app, the control size is.
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  /** `md` (default) for standalone forms, `sm` for dense editing surfaces. */
  size?: ControlSize;
  /** Emit `w-full` (default). `false` for inline controls. */
  fullWidth?: boolean;
  /** Wrapper element classes (the control itself takes `className`). */
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      id,
      size = 'md',
      fullWidth = true,
      className = '',
      wrapperClassName = '',
      children,
      ...props
    },
    ref,
  ) => {
    const selectId = id || props.name;
    return (
      <div className={wrapperClassName || (fullWidth ? 'w-full' : undefined)}>
        {label && (
          <label htmlFor={selectId} className={controlLabelClass}>
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={controlClass({ size, error: !!error, fullWidth, className })}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error && selectId ? `${selectId}-error` : undefined}
          {...props}
        >
          {children}
        </select>
        {error && (
          <p
            id={selectId ? `${selectId}-error` : undefined}
            className={controlErrorClass}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
