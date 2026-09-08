import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { requireVerifiedActor, requireOwnProfileId } from "@/lib/auth/guards";
import { getLatestAssessment } from "@/services/assessment/assessment-service";
import { getReviewOffer, requestReview } from "@/services/assessment/review-service";
import { optionalText } from "@/lib/validation";

// GET  /api/v1/assessment/review?resultId= — whether a consultant review is bought,
//                                            requested, or delivered for that result.
// POST /api/v1/assessment/review            — open the request (entitlement required).
//
// Both resolve the result through the service, which checks ownership against the
// database. A caller who guesses another student's result id gets the same "does not
// exist" they would get for a fictional one.

const requestSchema = z.object({
  resultId: z.string().uuid(),
  // What the student wants a second opinion on. Optional — plenty of people just want
  // someone to look.
  studentNote: optionalText(2000),
});

/** Falls back to the caller's latest assessment so the client need not pass an id. */
async function resolveResultId(
  profileId: string,
  requested: string | null,
): Promise<string> {
  const resultId = requested ?? (await getLatestAssessment(profileId))?.id;
  if (!resultId) throw new AppError("RESOURCE_NOT_FOUND", "You have no assessment yet.");
  return resultId;
}

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const profileId = await requireOwnProfileId(actor);
    const resultId = await resolveResultId(
      profileId,
      request.nextUrl.searchParams.get("resultId"),
    );

    const offer = await getReviewOffer(actor.userId, resultId);
    return ok(offer, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    await enforceRateLimit("ASSESSMENT_REVIEW_REQUEST", actor.userId);
    await requireOwnProfileId(actor);
    const body = await parseBody(request, requestSchema);

    const review = await requestReview({
      userId: actor.userId,
      resultId: body.resultId,
      studentNote: body.studentNote,
    });

    return ok({ review }, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}
