import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireVerifiedActor } from "@/lib/auth/guards";
import { confirmUpload } from "@/services/vault/vault-service";

// POST /api/v1/vault/documents/:id/confirm
// The server reads the object back and decides whether the upload is acceptable; the
// client saying "done" is a trigger, not evidence.

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const { id } = await context.params;
    const document = await confirmUpload({ userId: actor.userId, documentId: id });
    return ok({ id: document.id, status: document.status }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
