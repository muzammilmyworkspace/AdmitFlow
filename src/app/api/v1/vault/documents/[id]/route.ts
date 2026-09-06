import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireVerifiedActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";
import { createDownloadUrl, deleteDocument } from "@/services/vault/vault-service";

// GET    /api/v1/vault/documents/:id — issues a short-lived signed download URL
// DELETE /api/v1/vault/documents/:id — soft-deletes, unless an active application
//                                      snapshot references it

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const { id } = await context.params;
    const result = await createDownloadUrl({
      documentId: id,
      actorId: actor.userId,
      isStaff: actor.permissions.has(PERMISSIONS.DOCUMENT_DOWNLOAD_ANY),
    });
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const { id } = await context.params;
    await deleteDocument({ userId: actor.userId, documentId: id });
    return ok(null, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
