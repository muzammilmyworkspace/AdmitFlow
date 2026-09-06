"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { UnlockedResultView } from "./types";

const ZONE_TONE = {
  SAFE: "success",
  TARGET: "primary",
  REACH: "warning",
} as const;

// Zone labels are compatibility language, never predictions. "Safe" as a bare word
// implies a guaranteed outcome the platform cannot and must not promise
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
    <Card className="mb-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{ZONE_LABEL[result.zone] ?? result.zone}</Badge>
            {result.flags.includes("ESTIMATED_PENDING_TEST") && (
              <Badge tone="warning">English estimated</Badge>
            )}
            {result.dataFreshness.isStale && <Badge tone="neutral">Data may be outdated</Badge>}
          </div>
          <h3 className="text-base font-semibold text-text-primary">{result.program.name}</h3>
          <p className="text-sm text-text-secondary">
            {result.program.university} · {result.program.city ? `${result.program.city}, ` : ""}
            {result.program.country}
            {result.program.worldRanking ? ` · Ranked #${result.program.worldRanking}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-primary">{result.overallScore}</p>
          <p className="text-xs text-text-secondary">compatibility</p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <span className="text-text-secondary">Tuition</span>
          <p className="font-medium text-text-primary">
            {result.tuition
              ? `${result.tuition.amount.toLocaleString()} ${result.tuition.currency}/yr`
              : "—"}
          </p>
        </div>
        <div>
          <span className="text-text-secondary">Duration</span>
          <p className="font-medium text-text-primary">{result.program.durationMonths} months</p>
        </div>
        <div>
          <span className="text-text-secondary">Next intake</span>
          <p className="font-medium text-text-primary">{result.nextIntake?.term ?? "—"}</p>
        </div>
        <div>
          <span className="text-text-secondary">Deadline</span>
          <p className="font-medium text-text-primary">
            {result.nextIntake?.applicationDeadline.slice(0, 10) ?? "—"}
          </p>
        </div>
      </div>

      <p className="mb-3 text-sm text-text-secondary">{result.reasoning}</p>

      {result.missingRequirements.length > 0 && (
        <div className="mb-3 rounded-md bg-warning/5 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            To be eligible you still need
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-text-primary">
            {result.missingRequirements.map((req) => (
              <li key={req}>{req}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="text-sm font-medium text-primary underline"
      >
        {expanded ? "Hide the breakdown" : "Why this score?"}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-text-secondary/15 pt-4">
          {result.factors
            .filter((f) => !f.skipped)
            .map((factor) => (
              <div key={factor.factorKey}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-text-primary">
                    {FACTOR_LABEL[factor.factorKey] ?? factor.factorKey}
                    <span className="ml-1.5 text-xs font-normal text-text-secondary">
                      weight {factor.weight}%
                    </span>
                  </span>
                  <span className="text-text-secondary">{factor.rawScore}/100</span>
                </div>
                <ProgressBar value={factor.rawScore} label={factor.factorKey} className="mb-1" />
                <p className="text-xs text-text-secondary">{factor.reasoning}</p>
              </div>
            ))}
          {result.factors.some((f) => f.skipped) && (
            <p className="text-xs text-text-secondary">
              Factors with no data on either side are excluded and their weight shared across
              the rest, rather than counted as zero.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-t border-text-secondary/15 pt-4">
        <Link href={`/dashboard/universities/${result.programId}`}>
          <Button variant="ghost" size="sm">
            Programme details
          </Button>
        </Link>
        <Link href={`/dashboard/applications/new?programId=${result.programId}`}>
          <Button size="sm">Start application</Button>
        </Link>
      </div>
    </Card>
  );
}
