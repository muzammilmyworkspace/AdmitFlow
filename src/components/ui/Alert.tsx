import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const TONE_CLASSES = {
  error: "border-error/30 bg-error/5 text-error",
  success: "border-success/30 bg-success/5 text-success",
  warning: "border-warning/30 bg-warning/5 text-warning",
  info: "border-info/30 bg-info/5 text-info",
} as const;

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof TONE_CLASSES;
}

// role="alert" (error/warning) makes assistive tech announce it immediately when it
// appears — role="status" (success/info) announces politely without interrupting.
export function Alert({ tone = "info", className, ...props }: AlertProps) {
  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cn("rounded-md border px-4 py-3 text-sm", TONE_CLASSES[tone], className)}
      {...props}
    />
  );
}
