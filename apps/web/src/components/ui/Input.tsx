'use client';

// THE text input. Control classes come from `input-styles.ts`, shared with
// <Select> and <Textarea> since 20.1.

import { forwardRef, type InputHTMLAttributes } from 'react';
import {
  controlClass,
  controlErrorClass,
  controlLabelClass,
  type ControlSize,
} from './input-styles';

// `size` is redefined: the native numeric `size` attribute is not used
// anywhere in this app, the control size is.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  /** `data-testid` on the error `<p>` — a spec that names it exactly (e.g. `token-form-error-name`). */
  errorTestId?: string;
  /** `md` (default) for standalone forms, `sm` for dense editing surfaces. */
  size?: ControlSize;
  fullWidth?: boolean;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      errorTestId,
      id,
      size = 'md',
      fullWidth = true,
      className = '',
      wrapperClassName = '',
      ...props
    },
    ref,
  ) => {
    const inputId = id || props.name;
    return (
      <div className={wrapperClassName || (fullWidth ? 'w-full' : undefined)}>
        {label && (
          <label htmlFor={inputId} className={controlLabelClass}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={controlClass({ size, error: !!error, fullWidth, className })}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <p
            id={`${inputId}-error`}
            data-testid={errorTestId}
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
Input.displayName = 'Input';
