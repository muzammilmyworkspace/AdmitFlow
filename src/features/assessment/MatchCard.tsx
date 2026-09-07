"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeInfo,
  CalendarClock,
  ChevronDown,
  Clock3,
  GraduationCap,
  MapPin,
  Trophy,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { cn } from "@/lib/cn";
import type { UnlockedResultView } from "./types";

const ZONE_TONE = {
  SAFE: "success",
  TARGET: "primary",
  REACH: "warning",
} as const;

// Zone labels are compatibility language, never predictions. "Safe" as a bare word implies
// a guaranteed outcome the platform cannot and must not promise
// (docs/00-project-charter.md, docs/16-assessment-engine.md).
const ZONE_LABEL: Record<string, string> = {
  SAFE: "Strong match",
  TARGET: "Good match",
  REACH: "Ambitious",
};

// The accent stripe along the top of each card. Enough to make the three zones legible
// at a glance in a dense grid, without turning the page into a traffic light.
const ZONE_ACCENT: Record<string, string> = {
  SAFE: "bg-secondary-500",
  TARGET: "bg-primary-600",
  REACH: "bg-warning",
};

const FACTOR_LABEL: Record<string, string> = {
  academic: "Academic",
  english: "English",
  budget: "Budget",
  programFit: "Programme fit",
  countryPreference: "Country",
  risk: "Academic history",
  deadline: "Deadline",
  documentReadiness: "Documents",
};

/**
 * One readable match.
 *
 * Laid out vertically rather than as a wide row: three of these sit side by side on a
 * desktop grid, which is what lets a student compare universities against each other
 * instead of scrolling past them one at a time.
 */
export function MatchCard({ result }: { result: UnlockedResultView }) {
  const [expanded, setExpanded] = useState(false);
  const tone = ZONE_TONE[result.zone as keyof typeof ZONE_TONE] ?? "neutral";

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-all duration-base hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md">
      <div className={cn("h-1 w-full", ZONE_ACCENT[result.zone] ?? "bg-border")} aria-hidden />

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Badge tone={tone}>{ZONE_LABEL[result.zone] ?? result.zone}</Badge>
            {result.program.worldRanking && (
              <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                <Trophy className="h-3.5 w-3.5" aria-hidden />
                World rank #{result.program.worldRanking}
              </span>
            )}
          </div>
          <ScoreRing
            value={result.overallScore}
            size={56}
            label={`Compatibility ${result.overallScore} of 100`}
          />
        </div>

        {/* University first: a student choosing between options thinks in institutions,
            and the programme name is the qualifier. */}
        <h3 className="text-base font-semibold leading-snug text-text-primary">
          {result.program.university}
        </h3>
        <p className="mt-1 flex items-start gap-1.5 text-sm leading-snug text-text-secondary">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <span>{result.program.name}</span>
        </p>

        <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-sm text-text-secondary">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <dt className="sr-only">Location</dt>
            <dd className="truncate">
              {result.program.city ? `${result.program.city}, ` : ""}
              {result.program.country}
            </dd>
          </div>
          {result.tuition && (
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
              <dt className="sr-only">Tuition</dt>
              <dd className="tabular-nums">
                {result.tuition.amount.toLocaleString()} {result.tuition.currency}
                <span className="text-text-muted">/yr</span>
              </dd>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <dt className="sr-only">Duration</dt>
            <dd>{result.program.durationMonths} months</dd>
          </div>
          {result.nextIntake && (
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
              <dt className="sr-only">Next intake</dt>
              <dd className="truncate">
                {result.nextIntake.term} · apply by{" "}
                {result.nextIntake.applicationDeadline.slice(0, 10)}
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-4 text-sm leading-relaxed text-text-secondary">{result.reasoning}</p>

        {result.missingRequirements.length > 0 && (
          <div className="mt-4 rounded-md border border-warning/25 bg-warning/[0.05] px-3.5 py-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-warning">
              To be eligible you still need
            </p>
            <ul className="space-y-1 text-sm text-text-primary">
              {result.missingRequirements.map((req) => (
                <li key={req} className="flex gap-2">
                  <span className="text-warning" aria-hidden>
                    •
                  </span>
                  {req}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {result.flags.includes("ESTIMATED_PENDING_TEST") && (
            <Badge tone="warning">
              <BadgeInfo aria-hidden />
              English estimated
            </Badge>
          )}
          {result.dataFreshness.label && (
            <Badge tone="neutral">{result.dataFreshness.label}</Badge>
          )}
        </div>

        {/* Pushes the actions to the bottom so cards of differing heights still line up
            along their bottom edge in the grid. */}
        <div className="flex-1" />
      </div>

      {/* Explainability is a product requirement, not a nice-to-have — docs/16 §"Output". */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm font-medium text-text-secondary transition-colors duration-fast hover:bg-bg hover:text-text-primary"
      >
        {expanded ? "Hide the breakdown" : "Why this score?"}
        <ChevronDown
          className={cn("h-4 w-4 transition-transform duration-base", expanded && "rotate-180")}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="space-y-3.5 border-t border-border bg-bg px-5 py-4 animate-fade-in">
          {result.factors
            .filter((f) => !f.skipped)
            .map((factor) => (
              <div key={factor.factorKey}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-text-primary">
                    {FACTOR_LABEL[factor.factorKey] ?? factor.factorKey}
                    <span className="ml-1.5 text-xs font-normal text-text-muted">
                      weight {factor.weight}%
                    </span>
                  </span>
                  <span className="tabular-nums text-text-secondary">{factor.rawScore}/100</span>
                </div>
                <ProgressBar value={factor.rawScore} label={factor.factorKey} className="mb-1.5" />
                <p className="text-xs leading-relaxed text-text-secondary">{factor.reasoning}</p>
              </div>
            ))}

          {result.factors.some((f) => f.skipped) && (
            <p className="border-t border-border pt-3 text-xs leading-relaxed text-text-muted">
              Factors with no data on either side are left out and their weight shared across
              the rest, rather than counted as zero against you.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3.5">
        <Link href={`/dashboard/universities/${result.programId}`} className="flex-1">
          <Button variant="ghost" size="sm" className="w-full">
            Details
          </Button>
        </Link>
        <Link href={`/dashboard/applications/new?programId=${result.programId}`} className="flex-1">
          <Button size="sm" className="w-full">
            Apply
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </div>
    </article>
  );
}
