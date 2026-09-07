import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const TONE_CLASSES = {
  neutral: "bg-primary-50 text-primary-600 ring-primary-100",
  primary: "bg-primary-100 text-primary-700 ring-primary-200",
  success: "bg-secondary-50 text-secondary-700 ring-secondary-200",
  warning: "bg-warning/10 text-warning ring-warning/20",
  error: "bg-error/10 text-error ring-error/20",
  info: "bg-info/10 text-info ring-info/20",
  brand: "bg-brand-gradient text-white ring-transparent",
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONE_CLASSES;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        "ring-1 ring-inset [&>svg]:h-3.5 [&>svg]:w-3.5",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
