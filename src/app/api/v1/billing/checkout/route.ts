import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireVerifiedActor } from "@/lib/auth/guards";
import { createCheckout } from "@/services/payments/billing-service";

// POST /api/v1/billing/checkout — docs/12-api-contracts.md §7.
// No amount is accepted from the client; the price is resolved server-side.

const schema = z.object({
  productKey: z.enum(["TARGET_UNLOCK", "APPLICATION_FEE", "CONSULTATION_40MIN"]),
  assessmentId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    await enforceRateLimit("CHECKOUT", actor.userId);
    const body = await parseBody(request, schema);

    const result = await createCheckout({
      userId: actor.userId,
      userEmail: actor.email,
      productKey: body.productKey,
      scope: {
        assessmentId: body.assessmentId,
        applicationId: body.applicationId,
        bookingId: body.bookingId,
      },
    });

    return ok(result, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}
