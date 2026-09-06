"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { apiPost, ApiError } from "@/lib/api-client";

// The paywall surface.
//
// Note what this component does NOT do: there is no blurred list of real programme names
// behind it, because the server never sent them (docs/54-decision-log.md D-5). All it
// knows is how many matches exist in each locked zone — which is exactly what the API
// returns. If this component were removed entirely, no locked data would be exposed.

export function LockedZone({
  assessmentId,
  targetCount,
  safeCount,
  visibleCount,
}: {
  assessmentId: string;
  targetCount: number;
  safeCount: number;
  /** How many matches the student can already read, so the copy can't overstate. */
  visibleCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const total = targetCount + safeCount;

  async function startCheckout() {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const result = await apiPost<{ checkoutUrl: string }>("/api/v1/billing/checkout", {
        productKey: "TARGET_UNLOCK",
        assessmentId,
      });
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start checkout.");
      setIsStarting(false);
    }
  }

  if (total === 0) return null;

  return (
    <Card className="border-secondary/40 bg-secondary/5">
      <h3 className="mb-1 text-lg font-semibold text-text-primary">
        {total} more {total === 1 ? "match" : "matches"} available
      </h3>
      <p className="mb-4 text-sm text-text-secondary">
        Your assessment found <strong>{safeCount}</strong> strong{" "}
        {safeCount === 1 ? "match" : "matches"} and <strong>{targetCount}</strong> good{" "}
        {targetCount === 1 ? "match" : "matches"}
        {visibleCount > 0
          ? `, ${visibleCount} of which ${visibleCount === 1 ? "is" : "are"} shown above.`
          : "."}{" "}
        Unlock to see the universities, programmes, tuition, deadlines, and the full
        compatibility breakdown for every one.
      </p>

      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}

      <Button onClick={startCheckout} isLoading={isStarting}>
        Unlock all matches — €9.99
      </Button>
      <p className="mt-3 text-xs text-text-secondary">
        One-off payment for this assessment. Re-running your assessment after major profile
        changes produces a new set of results.
      </p>
    </Card>
  );
}
