"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, MessagesSquare, UserRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

// The €10 consultant review — the human half of the product.
//
// The engine explains how it scored each programme; it cannot tell a student which of
// three good options actually suits them, or that the thing holding their application
// back is a personal statement nobody has read. That is what this buys.
//
// The four states below are read from the server on every mount. Nothing here decides
// that a payment succeeded: `isPurchased` comes from the entitlement ledger, which is
// only ever written by the provider's webhook (docs/18-paywall-and-entitlements.md).

const REVIEW_PRICE = "€10";

const PROMISES = [
  "A consultant reads your full profile and your matches",
  "Written answer on which options actually fit you, and why",
  "What to strengthen before you apply — in priority order",
];

interface ReviewView {
  id: string;
  status: "REQUESTED" | "IN_REVIEW" | "COMPLETED" | "CANCELED";
  studentNote: string | null;
  reviewerNotes: string | null;
  requestedAt: string;
  completedAt: string | null;
  reviewerName: string | null;
}

interface OfferResponse {
  review: ReviewView | null;
  isPurchased: boolean;
}

export function ConsultantReview({
  resultId,
  assessmentId,
}: {
  /** Identifies which result is being reviewed. */
  resultId: string;
  /**
   * Scopes the purchase. Distinct from resultId and not interchangeable with it: the
   * entitlement is checked against the assessment, so sending the wrong one here buys a
   * grant that never matches and the student pays for nothing.
   */
  assessmentId: string;
}) {
  const [offer, setOffer] = useState<OfferResponse | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await apiGet<OfferResponse>(
      `/api/v1/assessment/review?resultId=${encodeURIComponent(resultId)}`,
    );
    setOffer(response);
  }, [resultId]);

  useEffect(() => {
    // A failure here must not take the results page down with it: the review offer is an
    // upsell beside the assessment, not part of it.
    load().catch(() => setOffer(null));
  }, [load]);

  async function startCheckout() {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ checkoutUrl: string }>("/api/v1/billing/checkout", {
        productKey: "ASSESSMENT_REVIEW",
        assessmentId,
      });
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start checkout.");
      setIsBusy(false);
    }
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/assessment/review", { resultId, studentNote: note || null });
      await load();
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send your request.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!offer) return null;

  const { review, isPurchased } = offer;

  // ---- Delivered -----------------------------------------------------------
  if (review?.status === "COMPLETED" && review.reviewerNotes) {
    return (
      <Card className="mt-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-50">
            <CheckCircle2 className="h-5 w-5 text-secondary-600" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-text-primary">
              Your consultant review
            </h2>
            <p className="text-sm text-text-secondary">
              {review.reviewerName ? `Written by ${review.reviewerName}` : "Written by a consultant"}
              {review.completedAt && ` · ${new Date(review.completedAt).toLocaleDateString()}`}
            </p>
          </div>
        </div>

        {review.studentNote && (
          <div className="mb-4 rounded-md border border-border bg-bg px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">
              You asked
            </p>
            <p className="text-sm leading-relaxed text-text-secondary">{review.studentNote}</p>
          </div>
        )}

        {/* whitespace-pre-wrap, never dangerouslySetInnerHTML: this is text a consultant
            typed, and it is rendered as text. */}
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {review.reviewerNotes}
        </div>
      </Card>
    );
  }

  // ---- Requested, awaiting a consultant ------------------------------------
  if (review) {
    const isClaimed = review.status === "IN_REVIEW";
    return (
      <Card className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
            <Clock className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-text-primary">
                Your review is {isClaimed ? "being written" : "in the queue"}
              </h2>
              <Badge tone={isClaimed ? "primary" : "neutral"}>
                {isClaimed ? "In review" : "Requested"}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-text-secondary">
              {isClaimed
                ? "A consultant has picked this up and is working through your profile."
                : "A consultant will pick this up shortly."}{" "}
              We&apos;ll email you the moment it&apos;s ready.
            </p>
          </div>
        </div>

        {review.studentNote && (
          <div className="mt-4 rounded-md border border-border bg-bg px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">
              What you asked
            </p>
            <p className="text-sm leading-relaxed text-text-secondary">{review.studentNote}</p>
          </div>
        )}
      </Card>
    );
  }

  // ---- Paid, but not yet told us what to look at ---------------------------
  if (isPurchased) {
    return (
      <Card tone="brand" className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">
          Your review is paid for — what should we look at?
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Optional, but it helps. Tell the consultant what you&apos;re unsure about and
          they&apos;ll answer it directly.
        </p>

        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        <form onSubmit={submitRequest} className="mt-4">
          <FormField label="Anything specific?" hint="Optional · up to 2000 characters">
            <Textarea
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. I can't decide between the UK and Canada, and I'm not sure my grades are strong enough for the programmes I actually want."
            />
          </FormField>
          <Button type="submit" isLoading={isBusy}>
            Send to a consultant
          </Button>
        </form>
      </Card>
    );
  }

  // ---- The offer -----------------------------------------------------------
  return (
    <Card className="mt-8 border-primary-200 bg-brand-gradient-soft">
      <div className="grid gap-6 md:grid-cols-[1.5fr_1fr] md:items-center">
        <div>
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary-200">
            <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
            Optional add-on
          </span>

          <h2 className="text-xl font-semibold tracking-tight text-text-primary">
            Want a consultant to go through this with you?
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-secondary">
            The assessment above shows you the numbers and the reasoning behind them. A
            consultant reads the whole picture — your grades, your budget, your shortlist —
            and tells you, in writing, which options are genuinely worth your application fee.
          </p>

          <ul className="mt-4 grid gap-2">
            {PROMISES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-secondary-600" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5 text-center shadow-sm">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary-50">
            <UserRound className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <p className="text-sm text-text-secondary">One-off, for this assessment</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-text-primary">
            {REVIEW_PRICE}
          </p>

          {error && (
            <Alert tone="error" className="mt-4 text-left">
              {error}
            </Alert>
          )}

          <Button onClick={startCheckout} isLoading={isBusy} className="mt-4 w-full">
            Get a consultant review
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            Written feedback, usually within a few working days. Not an admission decision —
            those rest with the universities.
          </p>
        </div>
      </div>
    </Card>
  );
}
