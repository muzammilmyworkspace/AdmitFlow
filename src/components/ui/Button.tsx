import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

// docs/07-frontend-architecture.md §6 — Button primitive. Token-driven; no component
// hardcodes a raw colour value (docs/54-decision-log.md D-12).
//
// Only `primary` carries the brand gradient. docs/07 §6 explicitly rules out gradients on
// every button — used everywhere, a gradient stops signalling anything.

const VARIANT_CLASSES = {
  primary:
    "bg-brand-gradient text-white shadow-brand-glow hover:brightness-[1.07] active:brightness-95",
  secondary: "bg-primary text-white shadow-sm hover:bg-primary-600",
  ghost:
    "bg-surface text-primary ring-1 ring-inset ring-border hover:bg-primary-50 hover:ring-primary-200",
  subtle: "bg-primary-50 text-primary-700 hover:bg-primary-100",
  danger: "bg-error text-white shadow-sm hover:brightness-110",
} as const;

const SIZE_CLASSES = {
  sm: "h-9 px-3.5 text-sm gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-12 px-7 text-base gap-2.5",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT_CLASSES;
  size?: keyof typeof SIZE_CLASSES;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", isLoading, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium",
          "transition-all duration-base",
          // Lifts on hover, settles on press. Both are suppressed under
          // prefers-reduced-motion by the global rule in globals.css.
          "hover:-translate-y-px active:translate-y-0",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading && <Spinner size="sm" className="text-current" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
