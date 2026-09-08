import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a hover lift. Only for cards that are themselves a link or button. */
  interactive?: boolean;
  /** Tinted treatment for the one card on a screen that should draw the eye. */
  tone?: "default" | "brand" | "warning";
}

const TONE_CLASSES = {
  // Slightly translucent over the shell's ambient wash, so a card reads as a pane
  // floating on the page rather than a white rectangle pasted onto a white page.
  default: "bg-surface/95 border-border backdrop-blur-sm",
  brand: "bg-brand-gradient-soft border-secondary-200",
  warning: "bg-warning/[0.04] border-warning/25",
} as const;

export function Card({ className, interactive, tone = "default", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-6 shadow-sm",
        TONE_CLASSES[tone],
        interactive &&
          "transition-all duration-base hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md",
        className,
      )}
      {...props}
    />
  );
}

/** Section heading used inside cards, so the eyebrow style is defined once. */
export function CardLabel({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-text-muted",
        className,
      )}
      {...props}
    />
  );
}
