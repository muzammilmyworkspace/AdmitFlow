import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { requireActiveActor } from "@/lib/auth/guards";
import { createApplication, listApplications } from "@/services/applications/application-service";

// GET  /api/v1/applications — the caller's own applications
// POST /api/v1/applications — start a draft for a programme + intake

const createSchema = z.object({
  programId: z.string().uuid(),
  intakeId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    const applications = await listApplications(actor.userId);
    return ok({ applications }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    const body = await parseBody(request, createSchema);
    const application = await createApplication({ userId: actor.userId, ...body });
    return ok({ id: application.id, status: application.status }, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}
