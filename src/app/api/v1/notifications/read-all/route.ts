import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireActor } from "@/lib/auth/guards";
import { markAllRead } from "@/services/notifications/notification-service";

// POST /api/v1/notifications/read-all — clears the caller's unread badge.

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const result = await markAllRead(actor.userId);
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
