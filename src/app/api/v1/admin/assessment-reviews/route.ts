import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { requirePermissionActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";
import { claimReview, completeReview, listReviewQueue } from "@/services/assessment/review-service";

// GET   /api/v1/admin/assessment-reviews  — the consultant work queue.
// PATCH /api/v1/admin/assessment-reviews  — claim one, or deliver it.
//
// Gated on the permission, never on a role name: the CONSULTANT bundle carries
// ASSESSMENT_REVIEW_DELIVER today and an admin may hold it too, so no call site here
// needs to know which roles exist (docs/13-authentication-authorization.md §6).

const STATUSES = ["REQUESTED", "IN_REVIEW", "COMPLETED", "CANCELED"] as const;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), reviewId: z.string().uuid() }),
  z.object({
    action: z.literal("complete"),
    reviewId: z.string().uuid(),
    // Length rules live in the service, which is the authority the UI and any future
    // caller both go through.
    notes: z.string(),
  }),
]);

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    await requirePermissionActor(PERMISSIONS.ASSESSMENT_REVIEW_DELIVER);

    const requested = request.nextUrl.searchParams.get("status");
    const status = STATUSES.find((s) => s === requested);

    const reviews = await listReviewQueue({ status });
    return ok({ reviews }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requirePermissionActor(PERMISSIONS.ASSESSMENT_REVIEW_DELIVER);
    const body = await parseBody(request, actionSchema);

    if (body.action === "claim") {
      await claimReview({ reviewerId: actor.userId, reviewId: body.reviewId });
    } else {
      await completeReview({
        reviewerId: actor.userId,
        reviewId: body.reviewId,
        notes: body.notes,
      });
    }

    const reviews = await listReviewQueue();
    return ok({ reviews }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
