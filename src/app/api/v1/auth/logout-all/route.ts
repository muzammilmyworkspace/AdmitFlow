import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { clearSessionCookie, getSessionUser, revokeAllSessions } from "@/lib/auth/session";

// POST /api/v1/auth/logout-all — revokes every session for the user across all devices,
// including the current one (docs/12-api-contracts.md §2).

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const current = await getSessionUser();
    if (!current) throw new AppError("AUTH_REQUIRED", "You must be signed in.");

    const sessionsRevoked = await revokeAllSessions(current.user.id);
    await clearSessionCookie();
    return ok({ sessionsRevoked }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
