import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireActiveActor } from "@/lib/auth/guards";
import { submitApplication } from "@/services/applications/application-service";

// POST /api/v1/applications/:id/submit
//
// Readiness is re-checked server-side inside the service; the UI having shown a green
// tick is not evidence. A repeat submit of an already-submitted application returns
// success with alreadySubmitted:true rather than an error — the user double-clicked, and
// the right outcome is one submission.

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    await enforceRateLimit("APPLICATION_SUBMIT", actor.userId);
    const { id } = await context.params;

    const result = await submitApplication({
      userId: actor.userId,
      applicationId: id,
      idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
    });

    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
