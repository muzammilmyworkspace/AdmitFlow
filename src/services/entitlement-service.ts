import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import type { Prisma } from "../../prisma/generated/client";

// Entitlements — docs/18-paywall-and-entitlements.md, docs/54-decision-log.md D-4.
//
// Access is a ledger, never a boolean flag on the user. Every check goes through
// hasEntitlement(); no call site is allowed to read a "isUnlocked" column, because that
// pattern is what makes pricing changes, refunds, admin grants and expiry impossible to
// model without a migration.

export const ENTITLEMENTS = {
  TARGET_RESULTS: "TARGET_RESULTS",
  SAFE_RESULTS: "SAFE_RESULTS",
  APPLICATION_SUBMISSION: "APPLICATION_SUBMISSION",
  CONSULTATION: "CONSULTATION",
  ADVANCED_ASSESSMENT: "ADVANCED_ASSESSMENT",
  ASSESSMENT_REVIEW: "ASSESSMENT_REVIEW",
  DOCUMENT_REVIEW: "DOCUMENT_REVIEW",
} as const;

export type EntitlementKey = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS];

/** Product keys as seeded — the sellable things that grant the entitlements above. */
export const PRODUCTS = {
  TARGET_UNLOCK: "TARGET_UNLOCK",
  APPLICATION_FEE: "APPLICATION_FEE",
  CONSULTATION_40MIN: "CONSULTATION_40MIN",
  ASSESSMENT_REVIEW: "ASSESSMENT_REVIEW",
} as const;

/** Which entitlements a given product grants when purchased. */
export const PRODUCT_GRANTS: Record<string, EntitlementKey[]> = {
  [PRODUCTS.TARGET_UNLOCK]: [ENTITLEMENTS.TARGET_RESULTS, ENTITLEMENTS.SAFE_RESULTS],
  [PRODUCTS.APPLICATION_FEE]: [ENTITLEMENTS.APPLICATION_SUBMISSION],
  [PRODUCTS.CONSULTATION_40MIN]: [ENTITLEMENTS.CONSULTATION],
  [PRODUCTS.ASSESSMENT_REVIEW]: [ENTITLEMENTS.ASSESSMENT_REVIEW],
};

export async function getOrCreateCustomer(userId: string) {
  const existing = await db.customer.findUnique({ where: { userId } });
  if (existing) return existing;
  return db.customer.create({ data: { userId } });
}

export interface EntitlementScope {
  assessmentId?: string;
  applicationId?: string;
  bookingId?: string;
}

function scopeMatches(stored: Prisma.JsonValue | null, wanted: EntitlementScope): boolean {
  // An ACCOUNT-scoped grant (no stored scope) satisfies any narrower request — that's
  // what makes a future subscription product work without changing call sites.
  if (stored === null || stored === undefined) return true;
  const scope = stored as EntitlementScope;
  if (scope.assessmentId && scope.assessmentId !== wanted.assessmentId) return false;
  if (scope.applicationId && scope.applicationId !== wanted.applicationId) return false;
  if (scope.bookingId && scope.bookingId !== wanted.bookingId) return false;
  return true;
}

/**
 * The single authority on "may this user see/do this".
 *
 * Checks live rows rather than any cached flag: a revoked or expired entitlement stops
 * working immediately, which is what makes refunds and admin revocation real rather than
 * eventually-consistent.
 */
export async function hasEntitlement(
  userId: string,
  entitlementKey: EntitlementKey,
  scope: EntitlementScope = {},
): Promise<boolean> {
  const customer = await db.customer.findUnique({ where: { userId } });
  if (!customer) return false;

  const now = new Date();
  const rows = await db.entitlement.findMany({
    where: {
      customerId: customer.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      product: { key: { in: productKeysGranting(entitlementKey) } },
    },
  });

  return rows.some((row) => scopeMatches(row.scope, scope));
}

function productKeysGranting(entitlementKey: EntitlementKey): string[] {
  return Object.entries(PRODUCT_GRANTS)
    .filter(([, grants]) => grants.includes(entitlementKey))
    .map(([productKey]) => productKey);
}

export async function listEntitlements(userId: string) {
  const customer = await db.customer.findUnique({ where: { userId } });
  if (!customer) return [];
  const now = new Date();
  const rows = await db.entitlement.findMany({
    where: {
      customerId: customer.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { product: true },
    orderBy: { grantedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    productKey: row.product.key,
    productName: row.product.name,
    grants: PRODUCT_GRANTS[row.product.key] ?? [],
    scope: row.scope as EntitlementScope | null,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
    sourceType: row.sourceType,
  }));
}

/**
 * Grants a product's entitlements.
 *
 * Called from the webhook handler inside the payment transaction, and from the admin
 * override path. `client` is threaded so the grant commits atomically with whatever
 * caused it (docs/09-database-architecture.md §7).
 */
export async function grantProductEntitlements(
  params: {
    customerId: string;
    productKey: string;
    sourceType: "PURCHASE" | "SUBSCRIPTION" | "ADMIN_GRANT" | "PROMOTIONAL";
    sourcePurchaseId?: string | null;
    scope?: EntitlementScope | null;
    expiresAt?: Date | null;
  },
  client: Prisma.TransactionClient | typeof db = db,
) {
  const product = await client.product.findUnique({ where: { key: params.productKey } });
  if (!product) throw new AppError("RESOURCE_NOT_FOUND", `Unknown product: ${params.productKey}`);

  return client.entitlement.create({
    data: {
      customerId: params.customerId,
      productId: product.id,
      sourceType: params.sourceType,
      sourcePurchaseId: params.sourcePurchaseId ?? null,
      scope: (params.scope ?? undefined) as Prisma.InputJsonValue | undefined,
      expiresAt: params.expiresAt ?? null,
    },
  });
}

/**
 * Admin override — grant. Requires a reason, always audited
 * (docs/25-admin-platform.md §"Admin overrides").
 */
export async function adminGrantEntitlement(params: {
  actorId: string;
  targetUserId: string;
  productKey: string;
  reason: string;
  scope?: EntitlementScope | null;
}) {
  if (!params.reason.trim()) {
    throw new AppError("VALIDATION_ERROR", "A reason is required for an entitlement override.");
  }
  const customer = await getOrCreateCustomer(params.targetUserId);

  return db.$transaction(async (tx) => {
    const entitlement = await grantProductEntitlements(
      {
        customerId: customer.id,
        productKey: params.productKey,
        sourceType: "ADMIN_GRANT",
        scope: params.scope ?? null,
      },
      tx,
    );
    await writeAuditLog(
      {
        actorId: params.actorId,
        actorType: "ADMIN",
        action: "entitlement.granted",
        entityType: "Entitlement",
        entityId: entitlement.id,
        metadata: {
          subtype: "ADMIN_GRANT",
          targetUserId: params.targetUserId,
          productKey: params.productKey,
          reason: params.reason,
        },
      },
      tx,
    );
    return entitlement;
  });
}

/** Admin override — revoke. Same rules: reason required, always audited. */
export async function adminRevokeEntitlement(params: {
  actorId: string;
  entitlementId: string;
  reason: string;
}) {
  if (!params.reason.trim()) {
    throw new AppError("VALIDATION_ERROR", "A reason is required to revoke an entitlement.");
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.entitlement.update({
      where: { id: params.entitlementId },
      data: { revokedAt: new Date(), revokedReason: params.reason },
    });
    await writeAuditLog(
      {
        actorId: params.actorId,
        actorType: "ADMIN",
        action: "admin.action",
        entityType: "Entitlement",
        entityId: updated.id,
        metadata: { subtype: "ENTITLEMENT_REVOKED", reason: params.reason },
      },
      tx,
    );
    return updated;
  });
}
