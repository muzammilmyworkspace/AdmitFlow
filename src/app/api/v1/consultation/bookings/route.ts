import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireActiveActor } from "@/lib/auth/guards";
import { createBookingHold, listMyBookings } from "@/services/consultation/consultation-service";

// GET  /api/v1/consultation/bookings — the caller's own bookings
// POST /api/v1/consultation/bookings — places a temporary hold on a slot, ahead of checkout

const reserveSchema = z.object({
  slotId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    const result = await listMyBookings(actor.userId);
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    await enforceRateLimit("BOOKING", actor.userId);
    const body = await parseBody(request, reserveSchema);
    const result = await createBookingHold({ userId: actor.userId, slotId: body.slotId });
    return ok(result, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}
