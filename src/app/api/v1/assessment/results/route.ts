import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireVerifiedActor, requireOwnProfileId } from "@/lib/auth/guards";
import { getLatestAssessment, listAssessments } from "@/services/assessment/assessment-service";
import { projectResultsForUser } from "@/services/assessment/result-projection";

// GET /api/v1/assessment/results — the caller's latest assessment, or ?id= for a
// specific historical one.
//
// Everything returned here goes through projectResultsForUser, which omits locked
// content entirely rather than flagging it (docs/54-decision-log.md D-5). There is no
// code path in this route that can reach the raw stored results.

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const profileId = await requireOwnProfileId(actor);

    const requestedId = request.nextUrl.searchParams.get("id");
    const resultId = requestedId ?? (await getLatestAssessment(profileId))?.id;

    if (!resultId) {
      return ok({ results: null, history: [] }, { requestId });
    }

    const projected = await projectResultsForUser(actor.userId, resultId);
    // Null covers both "no such result" and "not yours" — an attacker probing ids learns
    // nothing about whether a given id exists (docs/49-threat-model.md).
    if (!projected) throw new AppError("RESOURCE_NOT_FOUND", "Assessment not found.");

    const history = await listAssessments(profileId);
    return ok({ results: projected, history }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
