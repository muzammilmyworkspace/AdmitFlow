import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { requirePermissionActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";
import { listPendingReviews, verifyDocument, rejectDocument } from "@/services/vault/vault-service";
import { notify } from "@/services/notifications/notification-service";
import { db } from "@/lib/db";

// GET   /api/v1/admin/documents — the review queue
// PATCH /api/v1/admin/documents — approve or reject one, with a mandatory reason on reject

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verify"),
    documentId: z.string().uuid(),
    notes: z.string().max(1000).nullish(),
  }),
  z.object({
    action: z.literal("reject"),
    documentId: z.string().uuid(),
    reasonCode: z.enum([
      "illegible_scan",
      "wrong_document_type",
      "expired_validity",
      "incomplete_pages",
      "mismatched_name",
      "suspected_fraud",
      "other",
    ]),
    notes: z.string().max(1000).nullish(),
  }),
]);

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    await requirePermissionActor(PERMISSIONS.DOCUMENT_REVIEW);
    const documents = await listPendingReviews();
    return ok({ documents }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requirePermissionActor(PERMISSIONS.DOCUMENT_REVIEW);
    const body = await parseBody(request, schema);

    const document =
      body.action === "verify"
        ? await verifyDocument({
            documentId: body.documentId,
            reviewerId: actor.userId,
            notes: body.notes,
          })
        : await rejectDocument({
            documentId: body.documentId,
            actorId: actor.userId,
            reasonCode: body.reasonCode,
            notes: body.notes,
          });

    // Telling the student is part of the review, not an optional extra — a document that
    // sits rejected silently blocks their whole application.
    const owner = await db.document.findUnique({
      where: { id: document.id },
      select: { ownerId: true, type: true },
    });
    if (owner) {
      await notify({
        userId: owner.ownerId,
        event: body.action === "verify" ? "DOCUMENT_VERIFIED" : "DOCUMENT_REJECTED",
        context: {
          documentType: owner.type.replace(/_/g, " "),
          reason: body.action === "reject" ? body.reasonCode.replace(/_/g, " ") : "",
        },
      });
    }

    return ok({ id: document.id, status: document.status }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
