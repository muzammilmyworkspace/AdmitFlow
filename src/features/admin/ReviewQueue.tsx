"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Hand } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Textarea } from "@/components/ui/Textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { apiGet, apiPatch, ApiError } from "@/lib/api-client";

// The consultant's workspace.
//
// The API behind this shipped with the €10 review product and had no interface at all:
// a review was delivered by someone calling PATCH with curl. Which meant the one thing
// the student actually paid a person to do was the least usable part of the product.

interface QueueItem {
  id: string;
  status: "REQUESTED" | "IN_REVIEW" | "COMPLETED" | "CANCELED";
  studentName: string;
  studentNote: string | null;
  assessmentResultId: string;
  assessedAt: string;
  requestedAt: string;
  claimedBy: string | null;
}

const STATUS_TONE = {
  REQUESTED: "warning",
  IN_REVIEW: "primary",
  COMPLETED: "success",
  CANCELED: "neutral",
} as const;

export function ReviewQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiGet<{ reviews: QueueItem[] }>("/api/v1/admin/assessment-reviews");
    setItems(response.reviews);
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Could not load the queue."),
    );
  }, [load]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const response = await apiPatch<{ reviews: QueueItem[] }>(
        "/api/v1/admin/assessment-reviews",
        body,
      );
      setItems(response.reviews);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  }

  if (items === null && !error) return <SkeletonList count={3} />;

  return (
    <div>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {items && items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="Reviews appear here as soon as a student pays for one and tells us what to look at."
        />
      ) : (
        <div className="space-y-4">
          {items?.map((item) => {
            const isClaimed = item.status === "IN_REVIEW";
            const draft = drafts[item.id] ?? "";
            return (
              <Card key={item.id}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-text-primary">{item.studentName}</h2>
                      <Badge tone={STATUS_TONE[item.status]}>
                        {item.status === "IN_REVIEW" ? "In review" : "Requested"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-text-secondary">
                      Requested {new Date(item.requestedAt).toLocaleDateString()} · assessed{" "}
                      {new Date(item.assessedAt).toLocaleDateString()}
                      {item.claimedBy && ` · claimed by ${item.claimedBy}`}
                    </p>
                  </div>

                  {!isClaimed && (
                    <Button
                      size="sm"
                      isLoading={busyId === item.id}
                      onClick={() => act(item.id, { action: "claim", reviewId: item.id })}
                    >
                      <Hand className="h-4 w-4" aria-hidden />
                      Claim
                    </Button>
                  )}
                </div>

                {item.studentNote ? (
                  <div className="mb-4 rounded-md border border-border bg-bg px-4 py-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">
                      What they asked
                    </p>
                    <p className="text-sm leading-relaxed text-text-primary">{item.studentNote}</p>
                  </div>
                ) : (
                  <p className="mb-4 text-sm text-text-secondary">
                    No specific question — they asked for a general read of their matches.
                  </p>
                )}

                {isClaimed && (
                  <div>
                    <label
                      htmlFor={`notes-${item.id}`}
                      className="mb-1.5 block text-sm font-medium text-text-primary"
                    >
                      Your review
                    </label>
                    <Textarea
                      id={`notes-${item.id}`}
                      rows={7}
                      value={draft}
                      onChange={(e) => setDrafts({ ...drafts, [item.id]: e.target.value })}
                      placeholder="Which of their options actually fit, why, and what to strengthen before applying."
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        isLoading={busyId === item.id}
                        // The service refuses anything shorter; matching it here means the
                        // consultant finds out before they submit, not after.
                        disabled={draft.trim().length < 20}
                        onClick={() =>
                          act(item.id, { action: "complete", reviewId: item.id, notes: draft })
                        }
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        Deliver to the student
                      </Button>
                      <span className="text-xs text-text-muted">
                        {draft.trim().length < 20
                          ? "Write the review before delivering it."
                          : "The student is emailed as soon as you send this."}
                      </span>
                    </div>
                  </div>
                )}

                {!isClaimed && (
                  <p className="flex items-center gap-1.5 text-xs text-text-muted">
                    <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                    Claim this to start writing.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
