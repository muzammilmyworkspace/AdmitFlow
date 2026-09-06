import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-text-secondary/15 bg-surface p-6 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
