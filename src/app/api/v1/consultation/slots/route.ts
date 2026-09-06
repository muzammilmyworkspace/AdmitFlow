import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireActiveActor } from "@/lib/auth/guards";
import { listAvailableSlots } from "@/services/consultation/consultation-service";

// GET /api/v1/consultation/slots — bookable consultant availability.
//
// Timestamps come back as raw UTC instants plus an explicit `timezone` marker; the client
// renders them in the viewer's own zone (docs/22-consultation-booking.md §6).

function dateParam(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    await requireActiveActor();
    const params = request.nextUrl.searchParams;
    const limit = Number(params.get("limit"));

    const result = await listAvailableSlots({
      consultantId: params.get("consultantId") ?? undefined,
      from: dateParam(params.get("from")),
      to: dateParam(params.get("to")),
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });

    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
