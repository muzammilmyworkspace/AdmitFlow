import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth/session";

// GET /api/v1/users/me — docs/12-api-contracts.md §3.
// Returns only the caller's own record; there is no id parameter to tamper with, which
// is the simplest possible form of the object-level authorization rule (docs/13 §7).

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const current = await getSessionUser();
    if (!current) throw new AppError("AUTH_REQUIRED", "You must be signed in.");

    const { user } = current;
    return ok(
      {
        id: user.id,
        email: user.email,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        firstName: user.profile?.firstName ?? null,
        lastName: user.profile?.lastName ?? null,
        roles: user.userRoles.map((ur) => ur.role.name),
      },
      { requestId },
    );
  } catch (error) {
    return fail(error, requestId);
  }
}
