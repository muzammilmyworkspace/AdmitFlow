import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
}

// Label is required, not optional: an unlabelled checkbox is unusable with a screen
// reader, and making it a required prop stops that from being possible by accident
// (docs/43-accessibility.md).
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, hint, ...props }, ref) => {
    const id = useId();
    return (
      <div className={cn("mb-3 flex items-start gap-2.5", className)}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-text-secondary/40 text-primary"
          {...props}
        />
        <label htmlFor={id} className="text-sm text-text-primary">
          {label}
          {hint && <span className="block text-xs text-text-secondary">{hint}</span>}
        </label>
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";
