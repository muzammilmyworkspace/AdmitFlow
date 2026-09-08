import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireActor } from "@/lib/auth/guards";
import { currentSessionTokenHash } from "@/lib/auth/session";
import { listSessions } from "@/services/account-service";

// GET /api/v1/users/me/sessions — every device currently able to act as this account.
export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const sessions = await listSessions(actor.userId, await currentSessionTokenHash());
    return ok({ sessions }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
