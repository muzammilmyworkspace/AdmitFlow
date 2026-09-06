import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Every list surface needs one of these, and every one must offer a next action —
// "what should I do next?" is the product's core UX principle, so an empty state that
// only says "nothing here" is a bug, not a style choice.
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-text-secondary/25 px-6 py-10 text-center",
        className,
      )}
    >
      <h3 className="mb-1 text-sm font-semibold text-text-primary">{title}</h3>
      <p className="mx-auto mb-4 max-w-sm text-sm text-text-secondary">{description}</p>
      {action}
    </div>
  );
}
