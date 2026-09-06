import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { requireStaffActor, requirePermissionActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";
import { listUsers, setUserStatus } from "@/services/admin-service";
import { adminGrantEntitlement, adminRevokeEntitlement } from "@/services/entitlement-service";

// GET   /api/v1/admin/users — paginated user search
// PATCH /api/v1/admin/users — status change or entitlement override, both reason-required

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setStatus"),
    userId: z.string().uuid(),
    status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("grantEntitlement"),
    userId: z.string().uuid(),
    productKey: z.enum(["TARGET_UNLOCK", "APPLICATION_FEE", "CONSULTATION_40MIN"]),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("revokeEntitlement"),
    entitlementId: z.string().uuid(),
    reason: z.string().min(1).max(500),
  }),
]);

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    await requireStaffActor();
    const params = request.nextUrl.searchParams;
    const result = await listUsers({
      query: params.get("q") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
    });
    return ok(
      { users: result.users },
      { requestId, pagination: { nextCursor: result.nextCursor, hasMore: result.hasMore } },
    );
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const body = await parseBody(request, schema);

    // Each override needs its own permission — a document reviewer should not be able to
    // hand out paid entitlements just because both live under /admin.
    if (body.action === "setStatus") {
      const actor = await requirePermissionActor(PERMISSIONS.ENTITLEMENT_GRANT);
      await setUserStatus({
        actorId: actor.userId,
        targetUserId: body.userId,
        status: body.status,
        reason: body.reason,
      });
    } else if (body.action === "grantEntitlement") {
      const actor = await requirePermissionActor(PERMISSIONS.ENTITLEMENT_GRANT);
      await adminGrantEntitlement({
        actorId: actor.userId,
        targetUserId: body.userId,
        productKey: body.productKey,
        reason: body.reason,
      });
    } else {
      const actor = await requirePermissionActor(PERMISSIONS.ENTITLEMENT_GRANT);
      await adminRevokeEntitlement({
        actorId: actor.userId,
        entitlementId: body.entitlementId,
        reason: body.reason,
      });
    }

    return ok({ applied: true }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
