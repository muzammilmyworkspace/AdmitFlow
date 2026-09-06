import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireActor } from "@/lib/auth/guards";
import { markRead } from "@/services/notifications/notification-service";

// PATCH /api/v1/notifications/:id/read
//
// The id is never trusted as an authorization decision: the service scopes the update by
// the caller's userId, so another student's id matches no row and 404s.

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const result = await markRead(actor.userId, id);
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
