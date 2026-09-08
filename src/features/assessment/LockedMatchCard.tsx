"use client";

import { CalendarClock, Clock3, Lock, MapPin, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { LockedResultView } from "./types";

// A match the student has not paid to see.
//
// Read what this component is given: `{ locked, placeholderId, zone }`. That is the whole
// payload — the server never sent a name, a university, a country, a fee or a score for
// this entry (docs/54-decision-log.md D-5, src/services/assessment/result-projection.ts).
//
// So there is nothing here to blur. The bars below are placeholders sized by a hash of
// the placeholder id, not redacted text: a CSS blur over real content is defeated by
// devtools in about four seconds, and would hand over exactly the data the student is
// being asked to pay for. The lock is real because the data is absent, not hidden.

const ZONE_LABEL: Record<string, string> = {
  SAFE: "Strong match",
  TARGET: "Good match",
  REACH: "Ambitious",
};

const ZONE_TONE = {
  SAFE: "success",
  TARGET: "primary",
  REACH: "warning",
} as const;

const ZONE_ACCENT: Record<string, string> = {
  SAFE: "bg-secondary-500/40",
  TARGET: "bg-primary-600/40",
  REACH: "bg-warning/40",
};

/**
 * Deterministic pseudo-random width from the placeholder id.
 *
 * Deterministic matters twice over: a width chosen with Math.random() differs between the
 * server render and the client one, which is a hydration mismatch, and bars that reshuffle
 * on every re-render read as a broken interface rather than a locked one.
 */
function widthFor(seed: string, index: number, min: number, max: number): string {
  let hash = 0;
  const key = `${seed}:${index}`;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `${min + (Math.abs(hash) % (max - min + 1))}%`;
}

function Bar({ seed, index, min, max }: { seed: string; index: number; min: number; max: number }) {
  return (
    <span
      className="block h-2.5 rounded-full bg-text-muted/15"
      style={{ width: widthFor(seed, index, min, max) }}
      aria-hidden
    />
  );
}

export function LockedMatchCard({
  result,
  onUnlock,
  className,
}: {
  result: LockedResultView;
  onUnlock: () => void;
  className?: string;
}) {
  const id = result.placeholderId;
  const zoneLabel = ZONE_LABEL[result.zone] ?? result.zone;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-dashed border-border bg-surface/60 shadow-sm transition-all duration-base hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md",
        className,
      )}
      aria-label={`A locked ${zoneLabel.toLowerCase()}. Unlock to see this university.`}
    >
      <div className={cn("h-1 w-full", ZONE_ACCENT[result.zone] ?? "bg-border")} aria-hidden />

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3.5 flex items-start justify-between gap-3">
          {/* The zone is the one honest thing we can say about a locked match, and it is
              already in the payload — so the student knows the calibre of what's behind
              the lock without learning which university it is. */}
          <Badge tone={ZONE_TONE[result.zone as keyof typeof ZONE_TONE] ?? "neutral"}>
            {zoneLabel}
          </Badge>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border bg-bg">
            <Lock className="h-5 w-5 text-text-muted" aria-hidden />
          </span>
        </div>

        <div className="space-y-2" aria-hidden>
          <Bar seed={id} index={0} min={62} max={92} />
          <Bar seed={id} index={1} min={40} max={70} />
        </div>

        <div className="mt-4 grid gap-2.5 border-t border-border pt-4" aria-hidden>
          {[MapPin, Wallet, Clock3, CalendarClock].map((Icon, i) => (
            <div key={i} className="flex items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-text-muted/50" aria-hidden />
              <Bar seed={id} index={i + 2} min={35} max={72} />
            </div>
          ))}
        </div>

        <div className="flex-1" />
      </div>

      <button
        type="button"
        onClick={onUnlock}
        className="flex w-full items-center justify-center gap-2 border-t border-border bg-bg px-5 py-3.5 text-sm font-medium text-primary transition-colors duration-fast hover:bg-primary-50 hover:text-primary-700"
      >
        <Lock className="h-4 w-4" aria-hidden />
        Unlock to see this match
      </button>
    </article>
  );
}
