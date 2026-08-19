"use client";
import { forwardRef, type InputHTMLAttributes } from "react";
import { components } from "@/styles/design-system";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-[var(--color-text-secondary)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`${components.input.base} ${error ? components.input.error : ""} ${props.disabled ? components.input.disabled : ""} ${className}`}
          {...props}
        />
        {error && <p className="text-sm text-[var(--color-danger-600)] font-medium">{error}</p>}
        {hint && !error && <p className="text-xs text-[var(--color-text-soft)]">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = "Input";
