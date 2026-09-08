import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Every list surface needs one of these, and every one must offer a next action —
// "what should I do next?" is the product's core UX principle, so an empty state that
// only says "nothing here" is a bug, not a style choice.
export function EmptyState({
  title,
  description,
  action,
  align = "center",
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /**
   * Centred standalone; left-aligned when it sits inside a card that is itself
   * left-aligned. This is a prop rather than a `text-left` in className because the
   * description also carried `mx-auto`, which kept centring the block no matter what the
   * caller said — so the text sat visibly indented under its own heading.
   */
  align?: "center" | "left";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-text-secondary/25 px-6 py-10",
        centered ? "text-center" : "text-left",
        className,
      )}
    >
      <h3 className="mb-1 text-sm font-semibold text-text-primary">{title}</h3>
      <p className={cn("mb-4 max-w-sm text-sm text-text-secondary", centered && "mx-auto")}>
        {description}
      </p>
      {action}
    </div>
  );
}
