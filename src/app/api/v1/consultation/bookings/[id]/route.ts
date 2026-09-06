import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireActiveActor } from "@/lib/auth/guards";
import { cancelBooking } from "@/services/consultation/consultation-service";

// DELETE /api/v1/consultation/bookings/:id — cancels the caller's own booking and frees
// the slot. A cancellation inside the free window is reported as late rather than refused
// (docs/22-consultation-booking.md §9.1).

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActiveActor();
    await enforceRateLimit("BOOKING", actor.userId);
    const { id } = await context.params;
    const result = await cancelBooking({ userId: actor.userId, bookingId: id });
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
