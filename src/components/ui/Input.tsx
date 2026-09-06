import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

// Accessible form input — accessibility requirements from docs/43-accessibility.md:
// visible focus state (global :focus-visible rule), aria-invalid wired by the caller
// via `invalid`, always paired with a <FormField> label (see FormField.tsx).
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-11 w-full rounded-md border bg-surface px-3 text-sm text-text-primary",
          "placeholder:text-text-secondary/70",
          "transition-colors duration-fast",
          invalid ? "border-error" : "border-text-secondary/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
