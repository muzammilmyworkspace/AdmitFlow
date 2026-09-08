import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireActor } from "@/lib/auth/guards";
import { revokeSession } from "@/services/account-service";

// DELETE /api/v1/users/me/sessions/:id — sign a specific device out.
//
// The service scopes the update by userId as well as by id, so a session id belonging to
// another account matches nothing and returns the same "not active" as an expired one.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const { id } = await params;
    await revokeSession(actor.userId, id);
    return ok({ revoked: true }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
