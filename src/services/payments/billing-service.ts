import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { getOrCreateCustomer, grantProductEntitlements, PRODUCT_GRANTS } from "@/services/entitlement-service";
import { getPaymentProvider, type VerifiedWebhookEvent } from "./provider";
import type { Prisma } from "../../../prisma/generated/client";

// Billing orchestration — docs/19-payment-architecture.md, docs/48-idempotency.md.
//
// The load-bearing rule: entitlements are granted only by processWebhookEvent, only
// after a signature has been verified, and only inside the same transaction that claims
// the event id. Nothing on the client path can grant access.

const CHECKOUT_EXPIRY_MINUTES = 30; // docs/54-decision-log.md D-10

export interface CheckoutRequest {
  userId: string;
  userEmail: string;
  productKey: string;
  /** Optional scope, e.g. which assessment a TARGET unlock applies to. */
  scope?: { assessmentId?: string; applicationId?: string; bookingId?: string };
}

/**
 * Checks that a scope the client supplied actually refers to something that client owns.
 *
 * Without this, `scope` is whatever the browser sent. Two things go wrong. A client bug
 * that sends the wrong id of the right shape (a result id where an assessment id belongs,
 * say) produces a grant that no entitlement check will ever match — the student pays and
 * receives nothing, silently, with a successful payment on record. And a deliberate
 * caller could scope a purchase to another student’s assessment. Both become a 400 here.
 */
async function assertScopeBelongsToUser(
  userId: string,
  scope: CheckoutRequest["scope"],
): Promise<void> {
  if (!scope) return;

  if (scope.assessmentId) {
    const assessment = await db.assessment.findUnique({
      where: { id: scope.assessmentId },
      select: { profile: { select: { userId: true } } },
    });
    if (assessment?.profile.userId !== userId) {
      throw new AppError("VALIDATION_ERROR", "That assessment is not yours to buy against.");
    }
  }

  if (scope.applicationId) {
    const application = await db.application.findUnique({
      where: { id: scope.applicationId },
      select: { studentId: true },
    });
    if (application?.studentId !== userId) {
      throw new AppError("VALIDATION_ERROR", "That application is not yours to buy against.");
    }
  }

  if (scope.bookingId) {
    const booking = await db.booking.findUnique({
      where: { id: scope.bookingId },
      select: { studentId: true },
    });
    if (booking?.studentId !== userId) {
      throw new AppError("VALIDATION_ERROR", "That booking is not yours to buy against.");
    }
  }
}

/**
 * Creates a Purchase and a provider checkout session.
 *
 * The price is resolved server-side from the Product/Price tables — a client-supplied
 * amount is never trusted or even accepted (docs/30-validation-rules.md §"currency").
 */
export async function createCheckout(request: CheckoutRequest) {
  const product = await db.product.findUnique({
    where: { key: request.productKey },
    include: { prices: { where: { isActive: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
  });
  if (!product || !product.isActive) {
    throw new AppError("RESOURCE_NOT_FOUND", "That product is not available.");
  }
  const price = product.prices[0];
  if (!price) throw new AppError("RESOURCE_NOT_FOUND", "That product has no active price.");

  // Before a Purchase row exists, so a bad scope never reaches the provider.
  await assertScopeBelongsToUser(request.userId, request.scope);

  const customer = await getOrCreateCustomer(request.userId);

  const purchase = await db.purchase.create({
    data: {
      customerId: customer.id,
      priceId: price.id,
      status: "PENDING",
      quantity: 1,
      scope: (request.scope ?? undefined) as Prisma.InputJsonValue | undefined,
      expiresAt: new Date(Date.now() + CHECKOUT_EXPIRY_MINUTES * 60 * 1000),
    },
  });

  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  const provider = getPaymentProvider();
  const session = await provider.createCheckoutSession({
    productKey: product.key,
    priceId: price.stripePriceId ?? price.id,
    amount: Number(price.amount),
    currency: price.currency,
    customerEmail: request.userEmail,
    purchaseId: purchase.id,
    successUrl: `${appUrl}/billing/success?purchase=${purchase.id}`,
    cancelUrl: `${appUrl}/billing?canceled=1`,
  });

  return {
    purchaseId: purchase.id,
    checkoutUrl: session.url,
    providerReference: session.providerReference,
    amount: Number(price.amount),
    currency: price.currency,
    productKey: product.key,
    expiresAt: purchase.expiresAt,
  };
}

export interface WebhookProcessResult {
  status: "PROCESSED" | "DUPLICATE" | "IGNORED";
  purchaseId?: string;
  entitlementsGranted?: number;
  scope?: { bookingId?: string; assessmentId?: string; applicationId?: string } | null;
  productKey?: string;
  customerUserId?: string;
}

/**
 * Processes one verified provider webhook event, exactly once.
 *
 * Idempotency: the WebhookEvent insert and the business writes share one transaction and
 * the insert is guarded by the unique (provider, providerEventId) constraint. A redelivery
 * hits that constraint and no-ops. Crucially the whole transaction rolls back on failure,
 * so a genuinely failed grant is NOT recorded as "seen" — the provider's next retry gets
 * a fresh attempt rather than being permanently swallowed (docs/48-idempotency.md §3).
 */
export async function processWebhookEvent(
  event: VerifiedWebhookEvent,
  providerName: "STRIPE" | "PAYPAL",
): Promise<WebhookProcessResult> {
  const result = await claimAndApply(event, providerName);

  // Post-commit side effects. These run AFTER the money/entitlement transaction commits,
  // deliberately: confirming a booking or sending a receipt must never be able to roll
  // back a settled payment, and a failure here must not make the provider retry an event
  // whose financial half already succeeded.
  if (result.status === "PROCESSED" && result.productKey === "CONSULTATION_40MIN") {
    const bookingId = result.scope?.bookingId;
    if (bookingId) {
      try {
        const { confirmBookingFromPayment } = await import(
          "@/services/consultation/consultation-service"
        );
        await confirmBookingFromPayment(bookingId, result.customerUserId);
      } catch (error) {
        // Loud, because the student has paid for a session that is not yet confirmed —
        // this needs a human, not a silent retry.
        logger.error("Paid consultation could not be confirmed", {
          service: "billing",
          operation: "processWebhookEvent",
          bookingId,
          purchaseId: result.purchaseId,
          errorCode: "INTERNAL_ERROR",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}

async function claimAndApply(
  event: VerifiedWebhookEvent,
  providerName: "STRIPE" | "PAYPAL",
): Promise<WebhookProcessResult> {
  try {
    return await db.$transaction(async (tx) => {
      // Claim the event id first. A duplicate delivery throws P2002 here and is caught
      // below as a no-op success.
      await tx.webhookEvent.create({
        data: {
          provider: providerName,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          rawPayload: event.raw as Prisma.InputJsonValue,
          processingStatus: "PROCESSED",
          processedAt: new Date(),
        },
      });

      if (!event.purchaseId) return { status: "IGNORED" as const };

      const purchase = await tx.purchase.findUnique({
        where: { id: event.purchaseId },
        include: { price: { include: { product: true } }, customer: true },
      });
      if (!purchase) return { status: "IGNORED" as const };

      // Second idempotency layer, at the PURCHASE level rather than the event level.
      // Event-id uniqueness alone is not enough: providers legitimately emit several
      // distinct events for one payment (e.g. checkout.session.completed AND
      // payment_intent.succeeded), each with its own id. Without this guard the second
      // one would grant the same entitlements again.
      if (purchase.status === "COMPLETED") {
        logger.info("Webhook for an already-completed purchase ignored", {
          service: "billing",
          operation: "processWebhookEvent",
          purchaseId: purchase.id,
          providerEventId: event.providerEventId,
        });
        return { status: "DUPLICATE" as const, purchaseId: purchase.id, entitlementsGranted: 0 };
      }

      if (event.status === "FAILED") {
        await tx.purchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
        await tx.payment.create({
          data: {
            purchaseId: purchase.id,
            customerId: purchase.customerId,
            provider: providerName,
            providerTransactionId: event.providerTransactionId,
            amount: event.amount ?? purchase.price.amount,
            currency: event.currency ?? purchase.price.currency,
            status: "FAILED",
            failureReason: event.eventType,
          },
        });
        return { status: "PROCESSED" as const, purchaseId: purchase.id, entitlementsGranted: 0 };
      }

      // Amount tampering check: the settled amount must match the price we issued. A
      // mismatch is refused rather than granted, and is loud in the logs.
      const expected = Number(purchase.price.amount);
      if (event.amount !== null && Math.abs(event.amount - expected) > 0.001) {
        logger.error("Webhook amount does not match the issued price", {
          service: "billing",
          operation: "processWebhookEvent",
          purchaseId: purchase.id,
          errorCode: "PAYMENT_FAILED",
        });
        throw new AppError("PAYMENT_FAILED", "Settled amount does not match the issued price.");
      }

      await tx.purchase.update({ where: { id: purchase.id }, data: { status: "COMPLETED" } });
      await tx.payment.create({
        data: {
          purchaseId: purchase.id,
          customerId: purchase.customerId,
          provider: providerName,
          providerTransactionId: event.providerTransactionId,
          amount: event.amount ?? purchase.price.amount,
          currency: event.currency ?? purchase.price.currency,
          status: "SUCCEEDED",
        },
      });

      const productKey = purchase.price.product.key;
      const grants = PRODUCT_GRANTS[productKey] ?? [];
      await grantProductEntitlements(
        {
          customerId: purchase.customerId,
          productKey,
          sourceType: "PURCHASE",
          sourcePurchaseId: purchase.id,
          // Read from our own Purchase row, recorded at checkout — never from the
          // provider payload, which is attacker-influenceable input.
          scope: (purchase.scope as { assessmentId?: string } | null) ?? null,
        },
        tx,
      );

      await writeAuditLog(
        {
          actorId: null,
          actorType: "SYSTEM",
          action: "payment.completed",
          entityType: "Purchase",
          entityId: purchase.id,
          metadata: { productKey, provider: providerName, grants },
        },
        tx,
      );

      return {
        status: "PROCESSED" as const,
        purchaseId: purchase.id,
        entitlementsGranted: grants.length,
        // Surfaced so post-commit side effects (confirming a booking, sending a receipt)
        // can run outside the transaction — see the caller below.
        scope: purchase.scope as { bookingId?: string } | null,
        productKey,
        customerUserId: purchase.customer.userId,
      };
    });
  } catch (error) {
    // P2002 on (provider, providerEventId) means this exact event was already processed.
    // That is the designed outcome of a redelivery, not an error.
    if (isUniqueConstraintError(error)) {
      logger.info("Duplicate webhook delivery ignored", {
        service: "billing",
        operation: "processWebhookEvent",
        providerEventId: event.providerEventId,
      });
      return { status: "DUPLICATE" };
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function listPurchases(userId: string) {
  const customer = await db.customer.findUnique({ where: { userId } });
  if (!customer) return [];
  return db.purchase
    .findMany({
      where: { customerId: customer.id },
      include: { price: { include: { product: true } }, payments: true },
      orderBy: { createdAt: "desc" },
    })
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        productKey: row.price.product.key,
        productName: row.price.product.name,
        amount: Number(row.price.amount),
        currency: row.price.currency,
        createdAt: row.createdAt,
        paidAt: row.payments.find((p) => p.status === "SUCCEEDED")?.createdAt ?? null,
      })),
    );
}

/**
 * Admin refund — docs/19-payment-architecture.md §5.
 * A full refund revokes the entitlements the purchase granted; a partial one does not.
 */
export async function refundPurchase(params: {
  actorId: string;
  purchaseId: string;
  reason: string;
  amount?: number;
}) {
  if (!params.reason.trim()) {
    throw new AppError("VALIDATION_ERROR", "A reason is required to issue a refund.");
  }

  return db.$transaction(async (tx) => {
    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id: params.purchaseId },
      include: { payments: true, price: true, entitlements: true },
    });
    const payment = purchase.payments.find((p) => p.status === "SUCCEEDED");
    if (!payment) throw new AppError("CONFLICT", "This purchase has no settled payment to refund.");

    const full = params.amount === undefined || Math.abs(params.amount - Number(payment.amount)) < 0.001;

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
        refundedAmount: params.amount ?? payment.amount,
      },
    });
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: full ? "REFUNDED" : purchase.status },
    });

    if (full) {
      await tx.entitlement.updateMany({
        where: { sourcePurchaseId: purchase.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: `Refunded: ${params.reason}` },
      });
    }

    await writeAuditLog(
      {
        actorId: params.actorId,
        actorType: "ADMIN",
        action: "refund.issued",
        entityType: "Purchase",
        entityId: purchase.id,
        metadata: { reason: params.reason, full, amount: params.amount ?? Number(payment.amount) },
      },
      tx,
    );

    return { refunded: true, full };
  });
}
