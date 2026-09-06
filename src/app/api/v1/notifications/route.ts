import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireActor } from "@/lib/auth/guards";
import { listNotifications } from "@/services/notifications/notification-service";

// GET /api/v1/notifications — the caller's own notification centre, newest first.
//
// requireActor rather than requireVerifiedActor: WELCOME is delivered before the address
// is verified (docs/23 §2), so gating this on verification would hide the very
// notification telling the student to verify.

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const rawPageSize = Number(params.get("pageSize"));

    const result = await listNotifications(actor.userId, {
      cursor: params.get("cursor") ?? undefined,
      pageSize: Number.isFinite(rawPageSize) ? rawPageSize : undefined,
    });

    return ok(
      { notifications: result.items, unreadCount: result.unreadCount },
      {
        requestId,
        pagination: {
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          pageSize: result.pageSize,
        },
      },
    );
  } catch (error) {
    return fail(error, requestId);
  }
}
