import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Leading affordance (an icon). Decorative — label text lives in <FormField>. */
  icon?: ReactNode;
}

// Accessible form input — docs/43-accessibility.md: visible focus (global :focus-visible),
// aria-invalid wired by the caller, always paired with a <FormField> label.
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, icon, ...props }, ref) => {
    // Email-helper extensions (Temp Mail, password managers) decorate inputs with their
    // own attributes and an icon before React hydrates, and React reports each as a
    // hydration mismatch even though nothing in the app produced it. The flag covers
    // only this element's attributes, so a real mismatch elsewhere is still reported —
    // the same narrow treatment the root layout gives <html> and <body>.
    const field = (
      <input
        ref={ref}
        suppressHydrationWarning
        aria-invalid={invalid || undefined}
        className={cn(
          "h-11 w-full rounded-md border bg-surface px-3.5 text-sm text-text-primary",
          "placeholder:text-text-muted",
          "transition-[border-color,box-shadow] duration-fast",
          invalid
            ? "border-error focus:border-error"
            : "border-border hover:border-primary-200 focus:border-secondary-400",
          "disabled:cursor-not-allowed disabled:bg-bg disabled:opacity-60",
          icon && "pl-10",
          className,
        )}
        {...props}
      />
    );

    if (!icon) return field;
    return (
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted [&>svg]:h-4 [&>svg]:w-4"
          aria-hidden
        >
          {icon}
        </span>
        {field}
      </div>
    );
  },
);
Input.displayName = "Input";
