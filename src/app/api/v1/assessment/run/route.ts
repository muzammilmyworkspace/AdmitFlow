import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireActiveActor, requireOwnProfileId } from "@/lib/auth/guards";
import { runAssessment } from "@/services/assessment/assessment-service";

// POST /api/v1/assessment/run — docs/12-api-contracts.md §5.
//
// POST rather than GET (the original sketch used GET): running an assessment creates a
// durable, immutable record and is explicitly not idempotent-by-URL, so it must not be
// cacheable, prefetchable, or retried by a browser on refresh.

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    const profileId = await requireOwnProfileId(actor);
    await enforceRateLimit("ASSESSMENT_RUN", actor.userId);

    const result = await runAssessment(actor.userId, profileId, "STUDENT_REQUEST");
    return ok(result, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}
