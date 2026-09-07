"use client";

import { Check, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GlowField } from "@/components/brand/WorldMotif";

// The paywall surface.
//
// Note what this component does NOT do: there is no blurred list of real programme names
// behind it, because the server never sent them (docs/54-decision-log.md D-5). All it
// knows is how many matches sit in each locked zone — exactly what the API returns. If
// this component were deleted, no locked data would be exposed.

const INCLUDED = [
  "Every university and programme name",
  "Tuition, intakes and application deadlines",
  "The full compatibility breakdown for each",
  "One-off payment — no subscription",
];

export function LockedZone({
  targetCount,
  safeCount,
  visibleCount,
  onUnlock,
  isStarting,
}: {
  targetCount: number;
  safeCount: number;
  /** How many matches the student can already read, so the copy can't overstate. */
  visibleCount: number;
  // Checkout lives in the parent so that this panel and every locked card start the same
  // purchase, and a failure from either surfaces in one place.
  onUnlock: () => void;
  isStarting: boolean;
}) {
  const total = targetCount + safeCount;

  if (total === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-xl bg-brand-gradient p-8 text-white shadow-lg">
      <GlowField />

      <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/15">
            <Lock className="h-3.5 w-3.5 text-secondary-200" aria-hidden />
            {total} more {total === 1 ? "match" : "matches"} found
          </p>

          <h3 className="text-2xl font-semibold tracking-tight">
            You have {safeCount} strong and {targetCount} good{" "}
            {targetCount === 1 ? "match" : "matches"} waiting.
          </h3>

          <p className="mt-3 max-w-lg text-white/70">
            {visibleCount > 0
              ? `${visibleCount} of them ${visibleCount === 1 ? "is" : "are"} shown above so you can see the quality of the fit. Unlock to see every one.`
              : "Unlock to see which universities they are, and why each one fits."}
          </p>

          <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-white/80">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-secondary-200" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg bg-white/10 p-6 text-center ring-1 ring-inset ring-white/15 backdrop-blur-sm">
          <p className="text-sm text-white/60">One-off, for this assessment</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight">€9.99</p>

          <Button
            onClick={onUnlock}
            isLoading={isStarting}
            size="lg"
            variant="secondary"
            className="mt-5 w-full bg-white text-primary hover:bg-white/90"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Unlock all matches
          </Button>

          <p className="mt-4 text-xs leading-relaxed text-white/50">
            Re-running your assessment after major profile changes produces a new set of
            results.
          </p>
        </div>
      </div>
    </div>
  );
}
