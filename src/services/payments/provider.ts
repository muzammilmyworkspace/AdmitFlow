import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

// Payment provider abstraction — docs/19-payment-architecture.md.
//
// Stripe is the primary provider and PayPal the secondary; both are reached through this
// interface so no provider-specific branching leaks into the billing service.
//
// The "dev" provider exists because this environment has no Stripe/PayPal credentials.
// It is NOT a fake success switch: it runs the identical server-side flow — a checkout
// session is created, the browser is redirected away, and entitlements are granted only
// when a webhook arrives at the real webhook endpoint carrying a real HMAC signature
// that the handler verifies. The parts that matter for correctness (signature check,
// idempotency ledger, transactional grant) are exercised exactly as in production.
// It refuses to load when APP_ENV=production.

export interface CheckoutSessionRequest {
  productKey: string;
  priceId: string;
  amount: number;
  currency: string;
  customerEmail: string;
  purchaseId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Where to send the browser to pay. */
  url: string;
  /** The provider's id for this session/order. */
  providerReference: string;
}

export interface VerifiedWebhookEvent {
  providerEventId: string;
  eventType: string;
  purchaseId: string | null;
  providerTransactionId: string;
  amount: number | null;
  currency: string | null;
  status: "SUCCEEDED" | "FAILED";
  raw: unknown;
}

export interface PaymentProviderDriver {
  readonly name: "STRIPE" | "PAYPAL";
  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession>;
  /**
   * Verifies the signature over the RAW body and parses the event.
   * Throws if the signature is absent, malformed, or does not match — no event is ever
   * parsed before it is verified (docs/14-security-architecture.md §14).
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<VerifiedWebhookEvent>;
}

// ------------------------------------------------------------------ dev driver ---

class DevPaymentDriver implements PaymentProviderDriver {
  readonly name = "STRIPE" as const;

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    const providerReference = `dev_cs_${request.purchaseId}`;
    // Routes to a local checkout page that stands in for the provider's hosted page.
    const params = new URLSearchParams({
      purchaseId: request.purchaseId,
      amount: String(request.amount),
      currency: request.currency,
      product: request.productKey,
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
    });
    return {
      url: `${getEnv().NEXT_PUBLIC_APP_URL}/billing/dev-checkout?${params.toString()}`,
      providerReference,
    };
  }

  async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<VerifiedWebhookEvent> {
    if (!signatureHeader) throw new Error("Missing webhook signature header.");

    const secret = getEnv().STRIPE_WEBHOOK_SECRET ?? getEnv().SESSION_SECRET;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = Buffer.from(signatureHeader, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
      throw new Error("Webhook signature verification failed.");
    }

    const payload = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data: {
        purchaseId: string;
        providerTransactionId: string;
        amount: number;
        currency: string;
        status: "SUCCEEDED" | "FAILED";
      };
    };

    return {
      providerEventId: payload.id,
      eventType: payload.type,
      purchaseId: payload.data.purchaseId,
      providerTransactionId: payload.data.providerTransactionId,
      amount: payload.data.amount,
      currency: payload.data.currency,
      status: payload.data.status,
      raw: payload,
    };
  }
}

// --------------------------------------------------------------- Stripe driver ---

class StripeDriver implements PaymentProviderDriver {
  readonly name = "STRIPE" as const;

  private async stripe() {
    const Stripe = (await import("stripe")).default;
    return new Stripe(getEnv().STRIPE_SECRET_KEY!, { apiVersion: "2025-02-24.acacia" });
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    const stripe = await this.stripe();
    // Checkout Session rather than a raw PaymentIntent: card data never touches our
    // servers, which keeps PCI scope minimal (docs/19-payment-architecture.md §2).
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: request.customerEmail,
      line_items: [{ price: request.priceId, quantity: 1 }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      // The purchase id travels with the session so the webhook can map the event back
      // to our own record without trusting anything the client sends.
      client_reference_id: request.purchaseId,
      metadata: { purchaseId: request.purchaseId, productKey: request.productKey },
    });
    return { url: session.url!, providerReference: session.id };
  }

  async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<VerifiedWebhookEvent> {
    if (!signatureHeader) throw new Error("Missing Stripe-Signature header.");
    const stripe = await this.stripe();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      getEnv().STRIPE_WEBHOOK_SECRET!,
    );

    const session = event.data.object as {
      id: string;
      client_reference_id?: string | null;
      payment_intent?: string | null;
      amount_total?: number | null;
      currency?: string | null;
    };

    return {
      providerEventId: event.id,
      eventType: event.type,
      purchaseId: session.client_reference_id ?? null,
      providerTransactionId: (session.payment_intent as string) ?? session.id,
      amount: session.amount_total != null ? session.amount_total / 100 : null,
      currency: session.currency?.toUpperCase() ?? null,
      status: event.type === "checkout.session.completed" ? "SUCCEEDED" : "FAILED",
      raw: event,
    };
  }
}

let driver: PaymentProviderDriver | null = null;

export function getPaymentProvider(): PaymentProviderDriver {
  if (driver) return driver;
  const env = getEnv();
  const stripeConfigured = !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

  if (!stripeConfigured && env.APP_ENV === "production") {
    throw new Error(
      "No payment provider is configured. Production requires Stripe credentials; the dev provider is development-only (docs/19-payment-architecture.md).",
    );
  }

  driver = stripeConfigured ? new StripeDriver() : new DevPaymentDriver();
  return driver;
}

/** Exposed so the dev checkout page can sign the webhook it posts back. */
export function signDevWebhook(rawBody: string): string {
  const secret = getEnv().STRIPE_WEBHOOK_SECRET ?? getEnv().SESSION_SECRET;
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
