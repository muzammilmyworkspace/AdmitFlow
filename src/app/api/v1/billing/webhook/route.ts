import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getPaymentProvider } from "@/services/payments/provider";
import { processWebhookEvent } from "@/services/payments/billing-service";

// POST /api/v1/billing/webhook — the ONLY path that grants a paid entitlement.
// docs/19-payment-architecture.md, docs/48-idempotency.md, docs/14-security-architecture.md §14.
//
// Order matters and is non-negotiable:
//   1. read the RAW body (never the parsed one — parsing first would break signature
//      verification and hand attacker-controlled JSON to the app before it's trusted)
//   2. verify the signature
//   3. only then process, inside a transaction keyed on the provider's event id
//
// This route is deliberately unauthenticated: the caller is the payment provider, and
// the signature IS the authentication.

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const rawBody = await request.text();
    const signature =
      request.headers.get("stripe-signature") ?? request.headers.get("x-admitflow-signature");

    const provider = getPaymentProvider();

    let event;
    try {
      event = await provider.verifyWebhook(rawBody, signature);
    } catch (verifyError) {
      // Rejected before any processing, and before any WebhookEvent row is written.
      logger.warn("Rejected a webhook with an invalid signature", {
        requestId,
        service: "billing",
        operation: "webhook",
        errorCode: "WEBHOOK_INVALID",
      });
      throw new AppError(
        "WEBHOOK_INVALID",
        verifyError instanceof Error ? verifyError.message : "Invalid webhook signature.",
      );
    }

    const result = await processWebhookEvent(event, provider.name);
    logger.info("Webhook processed", {
      requestId,
      service: "billing",
      operation: "webhook",
      status: result.status,
    });

    // A duplicate returns 200: the provider has delivered successfully and must not be
    // told to retry (docs/48-idempotency.md §3).
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
