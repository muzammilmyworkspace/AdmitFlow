"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeInfo,
  CalendarClock,
  ChevronDown,
  Clock3,
  MapPin,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
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

export function MatchCard({ result }: { result: UnlockedResultView }) {
  const [expanded, setExpanded] = useState(false);
  const tone = ZONE_TONE[result.zone as keyof typeof ZONE_TONE] ?? "neutral";

  return (
    <Card className="mb-4 overflow-hidden p-0">
      <div className="flex gap-5 p-6">
        <ScoreRing value={result.overallScore} label={`Compatibility ${result.overallScore} of 100`} />

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{ZONE_LABEL[result.zone] ?? result.zone}</Badge>
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

          <h3 className="text-lg font-semibold leading-snug text-text-primary">
            {result.program.name}
          </h3>
          <p className="mt-0.5 text-sm text-text-secondary">{result.program.university}</p>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-text-muted" aria-hidden />
              {result.program.city ? `${result.program.city}, ` : ""}
              {result.program.country}
            </span>
            {result.tuition && (
              <span className="inline-flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-text-muted" aria-hidden />
                {result.tuition.amount.toLocaleString()} {result.tuition.currency}/yr
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-4 w-4 text-text-muted" aria-hidden />
              {result.program.durationMonths} months
            </span>
            {result.nextIntake && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-text-muted" aria-hidden />
                {result.nextIntake.term} · apply by{" "}
                {result.nextIntake.applicationDeadline.slice(0, 10)}
              </span>
            )}
          </div>

          <p className="mt-3.5 text-sm leading-relaxed text-text-secondary">{result.reasoning}</p>

          {result.missingRequirements.length > 0 && (
            <div className="mt-4 rounded-md border border-warning/25 bg-warning/[0.05] px-4 py-3">
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
        </div>
      </div>

      {/* Explainability is a product requirement, not a nice-to-have — docs/16 §"Output". */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 border-t border-border px-6 py-3.5 text-sm font-medium text-text-secondary transition-colors duration-fast hover:bg-bg hover:text-text-primary"
      >
        {expanded ? "Hide the breakdown" : "Why this score?"}
        <ChevronDown
          className={cn("h-4 w-4 transition-transform duration-base", expanded && "rotate-180")}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border bg-bg px-6 py-5 animate-fade-in">
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

      <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
        <Link href={`/dashboard/universities/${result.programId}`}>
          <Button variant="ghost" size="sm">
            Programme details
          </Button>
        </Link>
        <Link href={`/dashboard/applications/new?programId=${result.programId}`}>
          <Button size="sm">
            Start application
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </div>
    </Card>
  );
}
