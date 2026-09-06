import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireActiveActor } from "@/lib/auth/guards";
import {
  attachDocument,
  changeStatus,
  getApplication,
} from "@/services/applications/application-service";

// GET   /api/v1/applications/:id — full detail incl. readiness (or the frozen snapshot)
// PATCH /api/v1/applications/:id — attach a document, or a student-permitted status move

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("attachDocument"), documentId: z.string().uuid() }),
  z.object({
    action: z.literal("changeStatus"),
    // Only the transitions a student may make themselves. Everything else is staff-only
    // and lives on the admin route.
    toStatus: z.enum(["WITHDRAWN", "OFFER_ACCEPTED", "OFFER_DECLINED", "READY_FOR_REVIEW", "READY_TO_SUBMIT", "DRAFT"]),
    reason: z.string().max(500).nullish(),
  }),
]);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    const { id } = await context.params;
    const application = await getApplication(actor.userId, id);
    if (!application) throw new AppError("RESOURCE_NOT_FOUND", "Application not found.");
    return ok({ application }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    const { id } = await context.params;
    const body = await parseBody(request, patchSchema);

    if (body.action === "attachDocument") {
      await attachDocument({ userId: actor.userId, applicationId: id, documentId: body.documentId });
    } else {
      await changeStatus({
        actorId: actor.userId,
        actorType: "STUDENT",
        applicationId: id,
        toStatus: body.toStatus,
        reason: body.reason ?? null,
      });
    }

    const application = await getApplication(actor.userId, id);
    return ok({ application }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
