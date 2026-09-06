"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
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
        <EmptyState
          title="No assessment yet"
          description="Run your first assessment to see which programmes fit your profile, and why."
          action={
            <Button onClick={runAssessment} isLoading={isRunning}>
              Run my assessment
            </Button>
          }
        />
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {counts.SAFE + counts.TARGET + counts.REACH} programmes matched
            </h2>
            <p className="text-sm text-text-secondary">
              Assessed {new Date(generatedAt).toLocaleDateString()} · engine{" "}
              {data.results.matchingEngineVersion} · rules {data.results.rulesVersion}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="success">{counts.SAFE} strong</Badge>
              <Badge tone="primary">{counts.TARGET} good</Badge>
              <Badge tone="warning">{counts.REACH} ambitious</Badge>
            </div>
          </div>
          <Button variant="ghost" onClick={runAssessment} isLoading={isRunning}>
            Re-run assessment
          </Button>
        </div>
        <p className="mt-4 border-t border-text-secondary/15 pt-3 text-xs text-text-secondary">
          This is an indicative eligibility assessment based on the information you provided
          and on programme data that may change. It is not an admission decision — those rest
          with the universities themselves.
        </p>
      </Card>

      {(lockedCounts.TARGET > 0 || lockedCounts.SAFE > 0) && (
        <div className="mb-6">
          <LockedZone
            assessmentId={assessmentId}
            targetCount={lockedCounts.TARGET}
            safeCount={lockedCounts.SAFE}
          />
        </div>
      )}

      {ZONE_ORDER.map((zone) => {
        const zoneResults = visible.filter((r) => r.zone === zone);
        if (zoneResults.length === 0) return null;
        return (
          <section key={zone} className="mb-8">
            <h2 className="text-lg font-semibold text-text-primary">{ZONE_HEADING[zone]}</h2>
            <p className="mb-3 text-sm text-text-secondary">{ZONE_BLURB[zone]}</p>
            {zoneResults.map((result) => (
              <MatchCard key={result.programId} result={result} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
