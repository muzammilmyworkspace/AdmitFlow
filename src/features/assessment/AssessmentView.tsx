"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, RefreshCw, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { MatchCard } from "./MatchCard";
import { LockedZone } from "./LockedZone";
import type { AssessmentResponse, UnlockedResultView } from "./types";

const ZONE_ORDER = ["SAFE", "TARGET", "REACH"] as const;
const ZONE_HEADING: Record<string, string> = {
  SAFE: "Strong matches",
  TARGET: "Good matches",
  REACH: "Ambitious options",
};
const ZONE_BLURB: Record<string, string> = {
  SAFE: "Your profile is comfortably compatible with these on the information you gave us.",
  TARGET: "Solid compatibility, with a few areas worth strengthening.",
  REACH: "A stretch on one or more requirements — worth considering, with eyes open.",
};

export function AssessmentView() {
  const [data, setData] = useState<AssessmentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiGet<AssessmentResponse>("/api/v1/assessment/results");
    setData(response);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load results."))
      .finally(() => setIsLoading(false));
  }, [load]);

  async function runAssessment() {
    if (isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      await apiPost("/api/v1/assessment/run");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run the assessment.");
    } finally {
      setIsRunning(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data?.results) {
    return (
      <>
        {error && (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        )}
        <Card tone="brand" className="text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-gradient shadow-brand-glow">
            <Sparkles className="h-6 w-6 text-white" aria-hidden />
          </span>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">
            Ready to see where you stand?
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
            We&apos;ll score every programme in the catalog against your profile and show you
            the reasoning behind each one.
          </p>
          <Button onClick={runAssessment} isLoading={isRunning} size="lg" className="mt-6">
            Run my assessment
          </Button>
        </Card>
      </>
    );
  }

  const { results, counts, lockedCounts, generatedAt, assessmentId } = data.results;
  const visible = results.filter((r): r is UnlockedResultView => !r.locked);

  return (
    <div>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-text-primary">
              {counts.SAFE + counts.TARGET + counts.REACH} programmes matched
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              Assessed {new Date(generatedAt).toLocaleDateString()} · engine{" "}
              {data.results.matchingEngineVersion} · rules {data.results.rulesVersion}
            </p>
          </div>
          <Button variant="ghost" onClick={runAssessment} isLoading={isRunning}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Re-run
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: "Strong matches", value: counts.SAFE, className: "text-secondary-700" },
            { label: "Good matches", value: counts.TARGET, className: "text-primary-700" },
            { label: "Ambitious", value: counts.REACH, className: "text-warning" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-md bg-bg px-4 py-3.5">
              <p className={`text-3xl font-semibold tabular-nums ${stat.className}`}>{stat.value}</p>
              <p className="mt-0.5 text-xs text-text-secondary">{stat.label}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 flex gap-2 border-t border-border pt-4 text-xs leading-relaxed text-text-muted">
          <Info className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>
            An indicative eligibility assessment based on what you told us and on programme
            data that may change. It is not an admission decision — those rest with the
            universities themselves.
          </span>
        </p>
      </Card>

      {ZONE_ORDER.map((zone) => {
        const zoneResults = visible.filter((r) => r.zone === zone);
        if (zoneResults.length === 0) return null;
        return (
          <section key={zone} className="mb-9">
            <div className="mb-4 flex items-baseline gap-2.5">
              <h2 className="text-lg font-semibold tracking-tight text-text-primary">
                {ZONE_HEADING[zone]}
              </h2>
              <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium tabular-nums text-text-secondary">
                {zoneResults.length}
              </span>
            </div>
            <p className="-mt-3 mb-4 text-sm text-text-secondary">{ZONE_BLURB[zone]}</p>
            {zoneResults.map((result) => (
              <MatchCard key={result.programId} result={result} />
            ))}
          </section>
        );
      })}

      {/* Placed after the readable matches, not before them: the panel's own copy refers
          to what is "shown above", and asking for money before showing any of the quality
          it is selling reads as a wall rather than an offer. */}
      {(lockedCounts.TARGET > 0 || lockedCounts.SAFE > 0) && (
        <LockedZone
          assessmentId={assessmentId}
          targetCount={lockedCounts.TARGET}
          safeCount={lockedCounts.SAFE}
          visibleCount={visible.filter((r) => r.zone !== "REACH").length}
        />
      )}
    </div>
  );
}
