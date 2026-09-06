import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { revokeCurrentSession } from "@/lib/auth/session";

// POST /api/v1/auth/logout — revokes the current server-side session record only.

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    await revokeCurrentSession();
    return ok(null, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
