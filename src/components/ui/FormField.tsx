import { useId } from "react";
import type { ReactElement } from "react";
import { cloneElement, isValidElement } from "react";

interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: ReactElement<{ id?: string; invalid?: boolean; "aria-describedby"?: string }>;
}

// Label/input/error composition — every form input in the app goes through this so
// label association and error announcement (docs/43-accessibility.md: "accessible
// error states... announced to assistive tech, not color-only") is never hand-rolled
// per-field and never forgotten.
export function FormField({ label, error, hint, children }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-text-primary">
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(children, { id, invalid: !!error, "aria-describedby": describedBy })
        : children}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-sm text-text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
