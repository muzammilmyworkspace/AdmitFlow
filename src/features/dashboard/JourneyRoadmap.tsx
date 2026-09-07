import Link from "next/link";
import {
  AlertTriangle,
  Award,
  Check,
  FileCheck2,
  Lock,
  Plane,
  ScanSearch,
  Send,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { JourneyStage } from "@/services/dashboard-service";

// The visual roadmap from the brief's §29 and §32: every stage shows its state, and
// "locked" is visibly different from "not done yet" so a student can tell what is waiting
// on them from what is waiting on something else.

const STAGE_ICONS = {
  profile: UserRound,
  assessment: ScanSearch,
  documents: FileCheck2,
  applications: Send,
  offer: Award,
  visa: Plane,
} as const;

const STATUS_STYLES = {
  COMPLETE: {
    ring: "ring-secondary-300",
    dot: "bg-brand-gradient text-white",
    label: "Done",
    labelClass: "text-secondary-700",
  },
  ACTIVE: {
    ring: "ring-primary-300",
    dot: "bg-primary text-white",
    label: "In progress",
    labelClass: "text-primary-700",
  },
  BLOCKED: {
    ring: "ring-error/40",
    dot: "bg-error text-white",
    label: "Needs you",
    labelClass: "text-error",
  },
  LOCKED: {
    ring: "ring-border",
    dot: "bg-primary-50 text-text-muted",
    label: "Locked",
    labelClass: "text-text-muted",
  },
} as const;

export function JourneyRoadmap({ stages }: { stages: JourneyStage[] }) {
  return (
    <ol className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {stages.map((stage) => {
        const Icon = STAGE_ICONS[stage.key as keyof typeof STAGE_ICONS] ?? UserRound;
        const style = STATUS_STYLES[stage.status];
        const isLocked = stage.status === "LOCKED";

        const body = (
          <div
            className={cn(
              "flex h-full items-start gap-3.5 rounded-lg border border-border bg-surface p-5 shadow-sm ring-1 ring-inset transition-all duration-base",
              style.ring,
              !isLocked && "hover:-translate-y-0.5 hover:shadow-md",
              isLocked && "opacity-70",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                style.dot,
              )}
            >
              {stage.status === "COMPLETE" ? (
                <Check className="h-5 w-5" aria-hidden />
              ) : stage.status === "BLOCKED" ? (
                <AlertTriangle className="h-5 w-5" aria-hidden />
              ) : isLocked ? (
                <Lock className="h-4 w-4" aria-hidden />
              ) : (
                <Icon className="h-5 w-5" aria-hidden />
              )}
            </span>

            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-text-primary">{stage.label}</span>
                <span className={cn("text-xs font-medium", style.labelClass)}>{style.label}</span>
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-text-secondary">
                {stage.detail}
              </span>
            </span>
          </div>
        );

        return (
          <li key={stage.key}>
            {isLocked ? body : <Link href={stage.href}>{body}</Link>}
          </li>
        );
      })}
    </ol>
  );
}
