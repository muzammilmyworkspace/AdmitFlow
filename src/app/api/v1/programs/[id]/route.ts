import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { getProgramDetail } from "@/services/catalog-service";

// GET /api/v1/programs/:id — public programme detail.

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const { id } = await context.params;
    const program = await getProgramDetail(id);
    if (!program) throw new AppError("RESOURCE_NOT_FOUND", "Programme not found.");
    return ok({ program }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
