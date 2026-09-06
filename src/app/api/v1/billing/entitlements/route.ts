import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireVerifiedActor } from "@/lib/auth/guards";
import { listEntitlements } from "@/services/entitlement-service";

// GET /api/v1/billing/entitlements — what the current user currently has access to.
// The client reads its unlock state from here; it never infers it from a payment
// redirect or a client-side success callback (docs/54-decision-log.md D-5).

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const entitlements = await listEntitlements(actor.userId);
    return ok({ entitlements }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
