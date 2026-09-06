import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireVerifiedActor } from "@/lib/auth/guards";
import { listPurchases } from "@/services/payments/billing-service";

// GET /api/v1/billing/purchases — the caller's own purchase history.

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const purchases = await listPurchases(actor.userId);
    return ok({ purchases }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
