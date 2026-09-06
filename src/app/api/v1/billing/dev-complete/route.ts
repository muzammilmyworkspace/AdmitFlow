import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { signDevWebhook } from "@/services/payments/provider";

// POST /api/v1/billing/dev-complete — development only.
//
// Stands in for the provider's own "customer finished paying" callback. It does NOT
// grant anything itself: it signs a webhook payload and posts it to the real webhook
// endpoint, which verifies the signature and runs the same transactional grant path
// production uses. That keeps the security-critical code on the tested path instead of
// having a second, weaker way to unlock things.
//
// It refuses to exist outside development.

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const env = getEnv();
    if (env.APP_ENV !== "development") {
      throw new AppError("RESOURCE_NOT_FOUND", "Not found.");
    }

    const body = (await request.json()) as { purchaseId?: string; outcome?: "SUCCEEDED" | "FAILED" };
    if (!body.purchaseId) throw new AppError("VALIDATION_ERROR", "purchaseId is required.");

    // The amount comes from the Purchase row, mirroring how a real provider reports what
    // it actually settled — not from the request, which would sidestep the webhook
    // handler's amount-tampering check and make that check untested.
    const purchase = await db.purchase.findUnique({
      where: { id: body.purchaseId },
      include: { price: true },
    });
    if (!purchase) throw new AppError("RESOURCE_NOT_FOUND", "Purchase not found.");

    const payload = JSON.stringify({
      id: `dev_evt_${randomUUID()}`,
      type: body.outcome === "FAILED" ? "checkout.session.failed" : "checkout.session.completed",
      data: {
        purchaseId: body.purchaseId,
        providerTransactionId: `dev_pi_${randomUUID()}`,
        amount: Number(purchase.price.amount),
        currency: purchase.price.currency,
        status: body.outcome ?? "SUCCEEDED",
      },
    });

    const response = await fetch(`${env.NEXT_PUBLIC_APP_URL}/api/v1/billing/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admitflow-signature": signDevWebhook(payload),
      },
      body: payload,
    });

    const result = await response.json();
    return ok({ webhookStatus: response.status, webhookResult: result }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
