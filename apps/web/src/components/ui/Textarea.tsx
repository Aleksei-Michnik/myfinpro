'use client';

// Phase 20 · Iteration 20.1 — THE textarea. Same contract as <Input>; control
// classes shared through `input-styles.ts`.

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import {
  controlClass,
  controlErrorClass,
  controlLabelClass,
  type ControlSize,
} from './input-styles';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  /** `md` (default) for standalone forms, `sm` for dense editing surfaces. */
  size?: ControlSize;
  fullWidth?: boolean;
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      id,
      size = 'md',
      fullWidth = true,
      className = '',
      wrapperClassName = '',
      ...props
    },
    ref,
  ) => {
    const textareaId = id || props.name;
    return (
      <div className={wrapperClassName || (fullWidth ? 'w-full' : undefined)}>
        {label && (
          <label htmlFor={textareaId} className={controlLabelClass}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={controlClass({ size, error: !!error, fullWidth, className })}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error && textareaId ? `${textareaId}-error` : undefined}
          {...props}
        />
        {error && (
          <p
            id={textareaId ? `${textareaId}-error` : undefined}
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
Textarea.displayName = 'Textarea';
