import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requirePermissionActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";
import { listAuditLog } from "@/services/admin-service";
import { writeAuditLog } from "@/lib/audit";

// GET /api/v1/admin/audit — the compliance trail.
//
// Reading it is itself audited: who looked at the audit log is exactly the kind of thing
// an audit log exists to record (docs/27-audit-logging.md §6).

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requirePermissionActor(PERMISSIONS.AUDIT_LOG_READ);
    const params = request.nextUrl.searchParams;

    const result = await listAuditLog({
      entityType: params.get("entityType") ?? undefined,
      actorId: params.get("actorId") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
    });

    await writeAuditLog({
      actorId: actor.userId,
      actorType: "ADMIN",
      action: "admin.action",
      entityType: "AuditLog",
      entityId: "query",
      metadata: { subtype: "AUDIT_LOG_ACCESSED", filters: Object.fromEntries(params) },
    });

    return ok(
      { entries: result.entries },
      { requestId, pagination: { nextCursor: result.nextCursor, hasMore: result.hasMore } },
    );
  } catch (error) {
    return fail(error, requestId);
  }
}
